import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { Contract, getAddress, getBytes, JsonRpcProvider, verifyMessage } from 'ethers';
import { hasValidBearerToken, loadBearerToken } from './auth.js';
import { validateDeploymentMode } from './deploymentMode.js';
import { createDecisionJournal } from './journal.js';
import { loadStateIdentity } from './stateIdentity.js';
import {
  assertLockEvent,
  releaseMessageHash,
  resolvePolicy,
  validateAttestation,
} from './policy.js';
import { loadSignerPolicy } from './runtimeConfig.js';
import { createSigningKey } from './signingKey.js';

const requiredFile = (envName) => {
  const file = process.env[envName];
  if (!file) throw new Error(`${envName} is required`);
  const value = fs.readFileSync(file);
  if (value.length === 0) throw new Error(`${envName} is empty`);
  return value;
};

const signingEnabled = process.env.SIGNER_RELEASE_SIGNING_ENABLED === 'true';
const deploymentMode = validateDeploymentMode();
const policy = loadSignerPolicy({ signingEnabled });
const signer = await createSigningKey();
if (policy?.signerAddress && getAddress(policy.signerAddress) !== signer.address) {
  throw new Error(`policy signer ${policy.signerAddress} does not match key ${signer.address}`);
}

const journal = createDecisionJournal(
  process.env.SIGNER_STATE_FILE || '/var/lib/multx-signer/signed-releases.jsonl',
  { strictPermissions: deploymentMode.production, expectedIdentity: deploymentMode.production
    ? loadStateIdentity(process.env.SIGNER_STATE_IDENTITY_FILE, signer.address) : null },
);

const challenge = getBytes(Buffer.from('MultX production signer transaction-free verification v1'));
const challengeSignature = await signer.signMessage(challenge);
if (verifyMessage(challenge, challengeSignature).toLowerCase() !== signer.address.toLowerCase()) {
  throw new Error('transaction-free key verification recovered the wrong signer');
}
console.log(`[signer] transaction-free key verification passed for ${signer.address}`);

if (!signingEnabled) console.log('[signer] release signing is disabled');

const providers = new Map();
const sourceContract = (source) => {
  const key = Number(source.chainId);
  if (!providers.has(key)) {
    const provider = new JsonRpcProvider(source.rpcUrl);
    const contract = new Contract(source.bridgeAddress, [
      'event TokensLocked(bytes32 indexed txHash,address indexed token,address indexed user,uint256 amount,uint256 targetChain,uint256 nonce)',
    ], provider);
    providers.set(key, { provider, contract });
  }
  return providers.get(key);
};

let signingQueue = Promise.resolve();
const serializeSigning = (fn) => {
  const run = signingQueue.then(fn, fn);
  signingQueue = run.catch(() => {});
  return run;
};

const verifyAndSign = async (input) => {
  const attestation = validateAttestation(input);
  const { source } = resolvePolicy(policy, attestation);
  const { provider, contract } = await sourceContract(source);

  const network = await provider.getNetwork();
  if (Number(network.chainId) !== attestation.sourceChain) throw new Error('source RPC chain ID mismatch');
  const tip = await provider.getBlockNumber();
  const confirmations = tip - attestation.sourceBlock + 1;
  if (confirmations < source.confirmations) {
    throw new Error(`source lock has ${confirmations} confirmations`);
  }

  const events = await contract.queryFilter(
    contract.filters.TokensLocked(attestation.sourceTxHash),
    attestation.sourceBlock,
    attestation.sourceBlock,
  );
  const event = events.find((candidate) => {
    try { assertLockEvent(candidate, attestation); return true; } catch { return false; }
  });
  assertLockEvent(event, attestation);

  const hash = releaseMessageHash(attestation);
  const key = `${attestation.sourceChain}:${attestation.sourceBridge.toLowerCase()}:${attestation.sourceNonce}`;
  return serializeSigning(async () => {
    // Persist the decision before producing a signature. A crash can withhold
    // a signature but cannot erase or replace the anti-equivocation decision.
    await journal.record(key, hash);
    return signer.signMessage(getBytes(hash));
  });
};

const readJson = (req) => new Promise((resolve, reject) => {
  const chunks = [];
  let total = 0;
  req.on('data', (chunk) => {
    total += chunk.length;
    if (total > 32 * 1024) {
      reject(new Error('request body exceeds 32 KiB'));
      req.destroy();
      return;
    }
    chunks.push(chunk);
  });
  req.on('end', () => {
    try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
    catch { reject(new Error('invalid JSON')); }
  });
  req.on('error', reject);
});

const send = (res, status, body) => {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'cache-control': 'no-store',
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(payload),
  });
  res.end(payload);
};

const transport = deploymentMode.transport;
let bearerToken = null;
let server;
const handler = async (req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    return send(res, 200, { status: 'healthy', signingEnabled });
  }

  if (transport === 'proxy-http') {
    if (String(req.headers['x-forwarded-proto'] || '').toLowerCase() !== 'https') {
      return send(res, 403, { error: 'tls_proxy_required' });
    }
    if (!hasValidBearerToken(req.headers.authorization, bearerToken)) {
      res.setHeader('www-authenticate', 'Bearer');
      return send(res, 401, { error: 'unauthorized' });
    }
  }

  try {
    if (req.method === 'GET' && req.url === '/v1/identity') {
      return send(res, 200, { address: signer.address });
    }
    if (req.method === 'POST' && req.url === '/v1/sign-release') {
      if (!signingEnabled) return send(res, 503, { error: 'signing_disabled' });
      const signature = await verifyAndSign(await readJson(req));
      return send(res, 200, { address: signer.address, signature });
    }
    return send(res, 404, { error: 'not_found' });
  } catch (error) {
    console.error(`[signer] request rejected: ${error.message}`);
    return send(res, 400, { error: 'request_rejected' });
  }
};

if (transport === 'proxy-http') {
  if (process.env.SIGNER_BEHIND_TLS_PROXY !== 'true') {
    throw new Error('proxy-http requires SIGNER_BEHIND_TLS_PROXY=true');
  }
  bearerToken = loadBearerToken();
  server = http.createServer(handler);
} else if (transport === 'mtls') {
  server = https.createServer({
    cert: requiredFile('SIGNER_TLS_CERT_FILE'),
    key: requiredFile('SIGNER_TLS_KEY_FILE'),
    ca: requiredFile('SIGNER_CLIENT_CA_FILE'),
    requestCert: true,
    rejectUnauthorized: true,
    minVersion: 'TLSv1.3',
  }, handler);
} else {
  throw new Error('SIGNER_TRANSPORT must be mtls or proxy-http');
}

server.headersTimeout = 10_000;
server.requestTimeout = 15_000;
server.keepAliveTimeout = 5_000;
server.maxRequestsPerSocket = 100;

const port = Number(process.env.SIGNER_PORT || (transport === 'proxy-http' ? 8080 : 9443));
if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
  throw new Error('SIGNER_PORT must be an integer between 1 and 65535');
}
server.listen(port, '0.0.0.0', () => {
  console.log(`[signer] listening on ${port}; transport=${transport}; key=${signer.kind}; address=${signer.address}`);
});
