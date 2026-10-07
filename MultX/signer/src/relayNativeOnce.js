import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { JsonRpcProvider } from 'ethers';
import { createNativeEvidenceVerifier } from './nativeEvidence.js';
import { parseNativeSignerPolicy, resolveNativeChain } from './nativePolicy.js';
import { createNativeRelayJournal } from './nativeRelayJournal.js';
import { relayNativeOnce } from './nativeRelay.js';

// Private files only. No key management, signature collection, unpause or retries.
try {
  const [approvalFile, expectedHash, policyFile, packetFile, transactionFile, journalDirectory] = process.argv.slice(2);
  if (process.argv.length !== 8 || process.env.MULTX_NATIVE_RELAY_ENABLED !== 'true' ||
      !/^[a-f0-9]{64}$/.test(expectedHash || '')) throw new Error('invalid disabled-by-default invocation');
  const approvalBytes = fs.readFileSync(approvalFile);
  const sha = bytes => createHash('sha256').update(bytes).digest('hex');
  if (sha(approvalBytes) !== expectedHash) throw new Error('approval hash mismatch');
  const approval = JSON.parse(approvalBytes);
  if (!path.isAbsolute(approval.journalDirectory || '') ||
      path.resolve(approval.journalDirectory) !== path.resolve(journalDirectory)) {
    throw new Error('approved journal path mismatch');
  }
  const policyBytes = fs.readFileSync(policyFile);
  if (sha(policyBytes) !== approval.policySha256) throw new Error('policy hash mismatch');
  const policy = parseNativeSignerPolicy(JSON.parse(policyBytes));
  const packet = JSON.parse(fs.readFileSync(packetFile));
  const chain = resolveNativeChain(policy, ['release', 'cancel'].includes(packet.action)
    ? packet.destination.chainId : packet.operation.sourceChain);
  const provider = new JsonRpcProvider(chain.rpcUrl, undefined, { cacheTimeout: -1 });
  const evidenceProviders = [];
  const makeProvider = url => {
    const rpc = new JsonRpcProvider(url, undefined, { cacheTimeout: -1 });
    evidenceProviders.push(rpc); return rpc;
  };
  const verifier = createNativeEvidenceVerifier(policy, {
    providerFactory: item => makeProvider(item.rpcUrl),
    finalityProviderFactory: item => makeProvider(item.finalityRpcUrl),
  });
  try {
    const result = await relayNativeOnce({ policy, packet, approval,
      rawTransaction: fs.readFileSync(transactionFile, 'utf8').trim(), provider,
      journal: createNativeRelayJournal(journalDirectory), verifier, enabled: true });
    process.stdout.write(JSON.stringify(result) + '\n');
  } finally { provider.destroy(); for (const rpc of evidenceProviders) rpc.destroy(); }
} catch {
  process.stderr.write('Native relay stopped. Inspect private approval/journal; do not retry or auto-refund.\n');
  process.exitCode = 1;
}
