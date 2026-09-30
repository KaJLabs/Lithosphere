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

function arg(name) {
  const index = process.argv.indexOf(name);
  if (index === -1 || !process.argv[index + 1]) throw new Error(`${name} is required`);
  return path.resolve(process.argv[index + 1]);
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

async function verifyChain(chain, plan) {
  const variable = `MULTX_RPC_${chain.chainId}`;
  const url = process.env[variable];
  invariant(url, `${variable} is required`);
  const provider = new ethers.providers.StaticJsonRpcProvider(url, { chainId: chain.chainId, name: chain.name });
  const network = await provider.getNetwork();
  invariant(network.chainId === chain.chainId, `chain ${chain.chainId} RPC identity mismatch`);
  const blockNumber = await provider.getBlockNumber();

  const [factoryCode, timelockCode, vaultCode] = await Promise.all([
    provider.getCode(plan.deterministicDeployment.factory),
    provider.getCode(plan.deterministicDeployment.timelockAddress),
    provider.getCode(plan.deterministicDeployment.vaultAddress),
  ]);
  invariant(factoryCode !== '0x', `chain ${chain.chainId} deterministic factory missing`);
  invariant(timelockCode === '0x', `chain ${chain.chainId} expected Timelock address already occupied`);
  invariant(vaultCode === '0x', `chain ${chain.chainId} expected vault address already occupied`);

  const policy = plan.governance.safePolicy;
  const safe = new ethers.Contract(plan.governance.safe, SAFE_ABI, provider);
  const [safeCode, version, owners, threshold, modulesPage, singleton, guard, fallback] = await Promise.all([
    provider.getCode(plan.governance.safe),
    safe.VERSION(),
    safe.getOwners(),
    safe.getThreshold(),
    safe.getModulesPaginated(SENTINEL, 10),
    provider.getStorageAt(plan.governance.safe, 0),
    provider.getStorageAt(plan.governance.safe, GUARD_SLOT),
    provider.getStorageAt(plan.governance.safe, FALLBACK_SLOT),
  ]);
  invariant(safeCode !== '0x', `chain ${chain.chainId} governance Safe missing`);
  invariant(version === policy.version, `chain ${chain.chainId} Safe version mismatch`);
  invariant(storageAddress(singleton).toLowerCase() === policy.implementation.toLowerCase(), `chain ${chain.chainId} Safe implementation mismatch`);
  invariant(sameSet(owners, policy.owners), `chain ${chain.chainId} Safe owners mismatch`);
  invariant(threshold.toNumber() === policy.threshold, `chain ${chain.chainId} Safe threshold mismatch`);
  invariant(modulesPage[0].length === 0, `chain ${chain.chainId} Safe modules must be empty`);
  invariant(storageAddress(guard).toLowerCase() === policy.guard.toLowerCase(), `chain ${chain.chainId} Safe guard mismatch`);
  invariant(storageAddress(fallback).toLowerCase() === policy.fallbackHandler.toLowerCase(), `chain ${chain.chainId} Safe fallback handler mismatch`);

  const dependencyAddresses = [chain.dex.factory, chain.dex.router, chain.dex.pool, policy.fallbackHandler];
  const dependencyCode = await Promise.all(dependencyAddresses.map(address => provider.getCode(address)));
  invariant(dependencyCode.every(code => code !== '0x'), `chain ${chain.chainId} approved dependency missing`);

  return { chainId: chain.chainId, blockNumber, result: 'PASS' };
}

async function main() {
  const plan = JSON.parse(fs.readFileSync(arg('--plan'), 'utf8'));
  invariant(plan.status === 'REVIEW_CANDIDATE_DO_NOT_EXECUTE' && plan.enabled === false, 'review-only disabled plan required');
  const results = [];
  for (const chain of plan.chains) results.push(await verifyChain(chain, plan));
  console.log(JSON.stringify({ result: 'PASS', checks: results, secretsExposed: false }, null, 2));
}

main().catch(error => {
  console.error(error.message);
  process.exit(1);
});
