const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');

const SAFE_ABI = [
  'function VERSION() view returns (string)',
  'function getOwners() view returns (address[])',
  'function getThreshold() view returns (uint256)',
  'function getModulesPaginated(address,uint256) view returns (address[],address)',
];
const SENTINEL = '0x0000000000000000000000000000000000000001';
const GUARD_SLOT = ethers.utils.id('guard_manager.guard.address');
const FALLBACK_SLOT = ethers.utils.id('fallback_manager.handler.address');
const EXACT_CHAINS = '1,56,8453';

function argument(name) {
  const index = process.argv.indexOf(name);
  if (index === -1 || !process.argv[index + 1]) throw new Error(`${name} is required`);
  return process.argv[index + 1];
}
function invariant(condition, message) {
  if (!condition) throw new Error(message);
}
function storageAddress(value) {
  return ethers.utils.getAddress(`0x${value.slice(-40)}`);
}
function sameSet(actual, expected) {
  return actual.length === expected.length &&
    actual.map(value => value.toLowerCase()).sort().join(',') === expected.map(value => value.toLowerCase()).sort().join(',');
}
function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}
function codeHash(code) {
  invariant(/^0x[0-9a-f]+$/i.test(code) && code !== '0x', 'runtime code missing');
  return sha256(Buffer.from(code.slice(2), 'hex'));
}
function exactHash(value, label) {
  invariant(/^[0-9a-f]{64}$/i.test(value || ''), `${label} missing`);
  return value.toLowerCase();
}

async function verifyChain(chain, plan) {
  const variable = `MULTX_RPC_${chain.chainId}`;
  const url = process.env[variable];
  invariant(url, `${variable} is required`);
  const provider = new ethers.providers.JsonRpcProvider({ url, timeout: 20000 });
  const measuredChainId = Number(BigInt(await provider.send('eth_chainId', [])));
  invariant(measuredChainId === chain.chainId, `chain ${chain.chainId} RPC identity mismatch`);

  const anchor = await provider.getBlock('latest');
  invariant(anchor && anchor.hash, `chain ${chain.chainId} anchor unavailable`);
  const blockTag = anchor.number;
  const identities = chain.runtimeIdentities || {};
  const policy = plan.governance.safePolicy;
  const safe = new ethers.Contract(plan.governance.safe, SAFE_ABI, provider);

  const [factoryCode, timelockCode, vaultCode, safeCode, version, owners, threshold,
    modulesPage, singletonSlot, guardSlot, fallbackSlot] = await Promise.all([
    provider.getCode(plan.deterministicDeployment.factory, blockTag),
    provider.getCode(plan.deterministicDeployment.timelockAddress, blockTag),
    provider.getCode(plan.deterministicDeployment.vaultAddress, blockTag),
    provider.getCode(plan.governance.safe, blockTag),
    safe.VERSION({ blockTag }),
    safe.getOwners({ blockTag }),
    safe.getThreshold({ blockTag }),
    safe.getModulesPaginated(SENTINEL, 10, { blockTag }),
    provider.getStorageAt(plan.governance.safe, 0, blockTag),
    provider.getStorageAt(plan.governance.safe, GUARD_SLOT, blockTag),
    provider.getStorageAt(plan.governance.safe, FALLBACK_SLOT, blockTag),
  ]);

  const implementation = storageAddress(singletonSlot);
  const [implementationCode, fallbackCode] = await Promise.all([
    provider.getCode(implementation, blockTag),
    provider.getCode(policy.fallbackHandler, blockTag),
  ]);
  invariant(codeHash(factoryCode) === exactHash(identities.deterministicFactoryRuntimeSha256, 'factory runtime hash'), `chain ${chain.chainId} deterministic factory runtime mismatch`);
  invariant(codeHash(safeCode) === exactHash(identities.safeProxyRuntimeSha256, 'Safe proxy runtime hash'), `chain ${chain.chainId} Safe proxy runtime mismatch`);
  invariant(implementation.toLowerCase() === chain.safeImplementation.toLowerCase(), `chain ${chain.chainId} Safe implementation mismatch`);
  invariant(codeHash(implementationCode) === exactHash(identities.safeImplementationRuntimeSha256, 'Safe implementation runtime hash'), `chain ${chain.chainId} Safe implementation runtime mismatch`);
  invariant(codeHash(fallbackCode) === exactHash(identities.fallbackHandlerRuntimeSha256, 'fallback runtime hash'), `chain ${chain.chainId} fallback runtime mismatch`);
  invariant(timelockCode === '0x', `chain ${chain.chainId} expected Timelock address already occupied`);
  invariant(vaultCode === '0x', `chain ${chain.chainId} expected vault address already occupied`);
  invariant(version === policy.version, `chain ${chain.chainId} Safe version mismatch`);
  invariant(sameSet(owners, policy.owners), `chain ${chain.chainId} Safe owners mismatch`);
  invariant(threshold.toNumber() === policy.threshold, `chain ${chain.chainId} Safe threshold mismatch`);
  invariant(modulesPage[0].length === 0 && modulesPage[1].toLowerCase() === SENTINEL, `chain ${chain.chainId} Safe module pagination incomplete`);
  invariant(storageAddress(guardSlot).toLowerCase() === policy.guard.toLowerCase(), `chain ${chain.chainId} Safe guard mismatch`);
  invariant(storageAddress(fallbackSlot).toLowerCase() === policy.fallbackHandler.toLowerCase(), `chain ${chain.chainId} Safe fallback handler mismatch`);

  const dependencyAddresses = [chain.dex.factory, chain.dex.router, chain.dex.pool];
  const dependencyCode = await Promise.all(dependencyAddresses.map(address => provider.getCode(address, blockTag)));
  invariant(dependencyCode.every(code => code !== '0x'), `chain ${chain.chainId} approved dependency missing`);
  const anchorRecheck = await provider.getBlock(blockTag);
  invariant(anchorRecheck && anchorRecheck.hash === anchor.hash, `chain ${chain.chainId} anchor changed during verification`);
  return { chainId: chain.chainId, blockNumber: blockTag, blockHash: anchor.hash, result: 'PASS' };
}

async function main() {
  const planPath = path.resolve(argument('--plan'));
  const expectedPlanSha256 = exactHash(argument('--expected-plan-sha256'), 'expected plan SHA-256');
  const planBytes = fs.readFileSync(planPath);
  invariant(sha256(planBytes) === expectedPlanSha256, 'approved plan SHA-256 mismatch');
  const plan = JSON.parse(planBytes);
  invariant(plan.status === 'REVIEW_CANDIDATE_DO_NOT_EXECUTE' && plan.enabled === false, 'review-only disabled plan required');
  invariant(Array.isArray(plan.chains) && plan.chains.map(chain => chain.chainId).sort((a, b) => a - b).join(',') === EXACT_CHAINS, 'exact three-chain plan required');
  const results = [];
  for (const chain of plan.chains) results.push(await verifyChain(chain, plan));
  invariant(results.length === 3, 'zero or incomplete chain checks');
  console.log(JSON.stringify({ result: 'PASS', planSha256: expectedPlanSha256, checks: results, secretsExposed: false }, null, 2));
}

main().catch(error => {
  console.error(error.message);
  process.exit(1);
});
