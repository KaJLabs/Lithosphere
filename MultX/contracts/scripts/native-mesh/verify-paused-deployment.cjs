const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');
const { verifyRoles, verifySafe } = require('../mainnet/verify-governance');

const EXACT_CHAINS = '1,56,8453';
const ZERO = ethers.constants.AddressZero;
const DEFAULT_ADMIN_ROLE = ethers.constants.HashZero;
const PROPOSER_ROLE = ethers.utils.id('PROPOSER_ROLE');
const EXECUTOR_ROLE = ethers.utils.id('EXECUTOR_ROLE');
const TIMELOCK_ABI = [
  'function getMinDelay() view returns(uint256)',
  'function hasRole(bytes32,address) view returns(bool)',
];
const VAULT_ABI = [
  'function owner() view returns(address)',
  'function paused() view returns(bool)',
  'function getValidators() view returns(address[])',
  'function signaturesRequired() view returns(uint256)',
  'function activeChainCount() view returns(uint256)',
  'function outstandingEscrow() view returns(uint256)',
  'function dailyDepositCap() view returns(uint256)',
  'function dailyPayoutCap() view returns(uint256)',
  'function depositVolume() view returns(uint256)',
  'function payoutVolume() view returns(uint256)',
  'function pauseGuardian() view returns(address)',
];

function argument(name) {
  const index = process.argv.indexOf(name);
  if (index === -1 || !process.argv[index + 1]) throw new Error(`${name} is required`);
  return process.argv[index + 1];
}
function invariant(condition, message) {
  if (!condition) throw new Error(message);
}
function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}
function codeHash(code) {
  invariant(/^0x[0-9a-f]+$/i.test(code) && code !== '0x', 'runtime code missing');
  return sha256(Buffer.from(code.slice(2), 'hex'));
}
function sameSet(actual, expected) {
  return actual.length === expected.length &&
    actual.map(value => value.toLowerCase()).sort().join(',') === expected.map(value => value.toLowerCase()).sort().join(',');
}
function exactChains(items, label) {
  invariant(Array.isArray(items) && items.map(item => Number(item.chainId)).sort((a, b) => a - b).join(',') === EXACT_CHAINS,
    `${label} must contain exactly chains ${EXACT_CHAINS}`);
}

async function getLogsByTopics(provider, address, fromBlock, toBlock, topics) {
  const logs = [];
  for (let start = fromBlock; start <= toBlock; start += 2000) {
    logs.push(...await provider.getLogs({ address, fromBlock: start, toBlock: Math.min(start + 1999, toBlock), topics }));
  }
  return logs;
}

async function verifyPristineVaultHistory(provider, vaultAddress, deployment, anchor) {
  const receipt = await provider.getTransactionReceipt(deployment.transactionHash);
  invariant(receipt?.blockHash?.toLowerCase() === deployment.blockHash.toLowerCase(),
    'vault constructor receipt changed');
  const expected = (receipt.logs || []).filter(log => log.address?.toLowerCase() === vaultAddress.toLowerCase());
  const expectedTopics = [
    ethers.utils.id('OwnershipTransferred(address,address)'),
    ethers.utils.id('ValidatorSetUpdated(address[])'),
    ethers.utils.id('Paused(address)'),
  ];
  invariant(expected.length === expectedTopics.length &&
    expectedTopics.every(topic => expected.some(log => log.topics?.[0] === topic)),
  'vault constructor event evidence incomplete');
  const logs = await getLogsByTopics(provider, vaultAddress, deployment.blockNumber, anchor, undefined);
  invariant(logs.length === expected.length, 'vault has post-constructor event history');
  const expectedByIndex = new Map(expected.map(log => [log.logIndex, log]));
  for (const log of logs) {
    const constructorLog = expectedByIndex.get(log.logIndex);
    invariant(!log.removed && log.transactionHash?.toLowerCase() === deployment.transactionHash.toLowerCase() &&
      log.blockNumber === deployment.blockNumber && log.blockHash?.toLowerCase() === deployment.blockHash.toLowerCase() &&
      constructorLog && log.data === constructorLog.data &&
      JSON.stringify(log.topics) === JSON.stringify(constructorLog.topics),
    'vault has post-constructor event history');
  }
  return logs.length;
}

async function verifyFactoryTransaction(provider, expected, txHash, blockTag, label, deployedAddress,
  expectedRuntimeSha256, confirmations = 1) {
  invariant(/^0x[0-9a-f]{64}$/i.test(txHash || ''), `${label} transaction hash missing`);
  const [transaction, receipt] = await Promise.all([
    provider.getTransaction(txHash), provider.getTransactionReceipt(txHash),
  ]);
  invariant(transaction && receipt, `${label} deployment transaction unavailable`);
  invariant(receipt.status === 1, `${label} deployment transaction failed`);
  invariant(blockTag - receipt.blockNumber + 1 >= confirmations,
    `${label} deployment transaction lacks required confirmations`);
  invariant(receipt.blockNumber > 0 && /^0x[0-9a-f]{64}$/i.test(receipt.blockHash || ''), `${label} creation block unavailable`);
  const creationBlock = await provider.getBlock(receipt.blockNumber);
  invariant(creationBlock?.hash?.toLowerCase() === receipt.blockHash.toLowerCase(), `${label} creation receipt is not canonical`);
  invariant(await provider.getCode(deployedAddress, receipt.blockNumber - 1) === '0x', `${label} code existed before creation`);
  invariant(codeHash(await provider.getCode(deployedAddress, receipt.blockNumber)) === expectedRuntimeSha256,
    `${label} creation runtime mismatch`);
  invariant((transaction.to || '').toLowerCase() === expected.to.toLowerCase(), `${label} factory mismatch`);
  invariant(transaction.value.eq(0), `${label} deployment transaction must have zero value`);
  invariant(transaction.data.toLowerCase() === expected.data.toLowerCase(), `${label} deployment calldata mismatch`);
  return { transactionHash: txHash, blockNumber: receipt.blockNumber, blockHash: receipt.blockHash };
}

async function verifyChain(chain, record, plan) {
  const url = process.env[`MULTX_RPC_${chain.chainId}`];
  invariant(url, `MULTX_RPC_${chain.chainId} is required`);
  const provider = new ethers.providers.JsonRpcProvider({ url, timeout: 20000 });
  const measuredChainId = Number(BigInt(await provider.send('eth_chainId', [])));
  invariant(measuredChainId === chain.chainId, `chain ${chain.chainId} RPC identity mismatch`);
  const anchor = await provider.getBlock('latest');
  invariant(anchor?.hash, `chain ${chain.chainId} anchor unavailable`);
  const blockTag = anchor.number;
  const timelockAddress = plan.deterministicDeployment.timelockAddress;
  const vaultAddress = plan.deterministicDeployment.vaultAddress;
  const timelock = new ethers.Contract(timelockAddress, TIMELOCK_ABI, provider);
  const vault = new ethers.Contract(vaultAddress, VAULT_ABI, provider);
  const [factoryCode, timelockCode, vaultCode, minDelay, proposer, executor, adminSelf, adminSafe,
    owner, paused, validators, threshold, activeChains, escrow, depositCap, payoutCap,
    depositVolume, payoutVolume, guardian, balance] = await Promise.all([
    provider.getCode(plan.deterministicDeployment.factory, blockTag),
    provider.getCode(timelockAddress, blockTag),
    provider.getCode(vaultAddress, blockTag),
    timelock.getMinDelay({ blockTag }),
    timelock.hasRole(PROPOSER_ROLE, plan.governance.safe, { blockTag }),
    timelock.hasRole(EXECUTOR_ROLE, plan.governance.safe, { blockTag }),
    timelock.hasRole(DEFAULT_ADMIN_ROLE, timelockAddress, { blockTag }),
    timelock.hasRole(DEFAULT_ADMIN_ROLE, plan.governance.safe, { blockTag }),
    vault.owner({ blockTag }), vault.paused({ blockTag }), vault.getValidators({ blockTag }),
    vault.signaturesRequired({ blockTag }), vault.activeChainCount({ blockTag }),
    vault.outstandingEscrow({ blockTag }), vault.dailyDepositCap({ blockTag }),
    vault.dailyPayoutCap({ blockTag }), vault.depositVolume({ blockTag }),
    vault.payoutVolume({ blockTag }), vault.pauseGuardian({ blockTag }),
    provider.getBalance(vaultAddress, blockTag),
  ]);
  invariant(codeHash(factoryCode) === chain.runtimeIdentities.deterministicFactoryRuntimeSha256,
    `chain ${chain.chainId} factory runtime mismatch`);
  invariant(codeHash(timelockCode) === plan.release.timelockRuntimeSha256, `chain ${chain.chainId} Timelock runtime mismatch`);
  invariant(codeHash(vaultCode) === plan.release.vaultRuntimeSha256, `chain ${chain.chainId} vault runtime mismatch`);
  invariant(minDelay.eq(172800), `chain ${chain.chainId} Timelock delay mismatch`);
  invariant(proposer && executor && adminSelf && !adminSafe, `chain ${chain.chainId} Timelock roles mismatch`);
  invariant(owner.toLowerCase() === timelockAddress.toLowerCase(), `chain ${chain.chainId} vault owner mismatch`);
  invariant(paused === true, `chain ${chain.chainId} vault is not paused`);
  invariant(sameSet(validators, plan.bridgeSignerSet.addresses), `chain ${chain.chainId} validator set mismatch`);
  invariant(threshold.eq(3), `chain ${chain.chainId} validator threshold mismatch`);
  invariant(activeChains.isZero() && escrow.isZero() && depositCap.isZero() && payoutCap.isZero() &&
    depositVolume.isZero() && payoutVolume.isZero() && balance.isZero(),
  `chain ${chain.chainId} vault is not pristine`);
  invariant(guardian === ZERO, `chain ${chain.chainId} pause guardian must be unset before configuration`);

  const safePolicy = {
    ...plan.governance.safePolicy,
    implementation: chain.safeImplementation,
    proxyRuntimeSha256: chain.runtimeIdentities.safeProxyRuntimeSha256,
    implementationRuntimeSha256: chain.runtimeIdentities.safeImplementationRuntimeSha256,
    fallbackHandlerRuntimeSha256: chain.runtimeIdentities.fallbackHandlerRuntimeSha256,
  };
  await verifySafe(provider, plan.governance.safe, safePolicy, blockTag, codeHash,
    (address, abi, reader) => new ethers.Contract(address, abi, reader), chain.chainId);

  const transactions = plan.deterministicDeployment.transactions;
  const provenance = [
    await verifyFactoryTransaction(provider, transactions[0], record.timelockTxHash, blockTag,
      `chain ${chain.chainId} Timelock`, timelockAddress, plan.release.timelockRuntimeSha256, chain.confirmations),
    await verifyFactoryTransaction(provider, transactions[1], record.vaultTxHash, blockTag,
      `chain ${chain.chainId} vault`, vaultAddress, plan.release.vaultRuntimeSha256, chain.confirmations),
  ];
  await verifyRoles(provider, timelock, {
    proposers: [plan.governance.safe], executors: [plan.governance.safe],
    cancellers: [plan.governance.safe], admins: [timelockAddress],
  }, provenance[0].blockNumber, blockTag, getLogsByTopics);
  const constructorLogs = await verifyPristineVaultHistory(provider, vaultAddress, provenance[1], blockTag);
  const recheck = await provider.getBlock(blockTag);
  invariant(recheck?.hash === anchor.hash, `chain ${chain.chainId} anchor changed during verification`);
  return { chainId: chain.chainId, blockNumber: blockTag, blockHash: anchor.hash, provenance,
    constructorLogs, result: 'PASS' };
}

async function main() {
  const planPath = path.resolve(argument('--plan'));
  const recordPath = path.resolve(argument('--deployment-record'));
  const expectedPlanSha256 = argument('--expected-plan-sha256').toLowerCase();
  invariant(/^[0-9a-f]{64}$/.test(expectedPlanSha256), 'expected plan SHA-256 is invalid');
  const planBytes = fs.readFileSync(planPath);
  invariant(sha256(planBytes) === expectedPlanSha256, 'approved plan SHA-256 mismatch');
  const plan = JSON.parse(planBytes);
  const record = JSON.parse(fs.readFileSync(recordPath, 'utf8'));
  invariant(plan.status === 'REVIEW_CANDIDATE_DO_NOT_EXECUTE' && plan.enabled === false, 'disabled reviewed plan required');
  exactChains(plan.chains, 'plan');
  exactChains(record.chains, 'deployment record');
  invariant(record.planSha256 === expectedPlanSha256, 'deployment record plan SHA-256 mismatch');
  const results = [];
  for (const chain of plan.chains) {
    const chainRecord = record.chains.find(item => Number(item.chainId) === chain.chainId);
    results.push(await verifyChain(chain, chainRecord, plan));
  }
  console.log(JSON.stringify({ result: 'PASS', planSha256: expectedPlanSha256, checks: results, secretsExposed: false }, null, 2));
}

if (require.main === module) main().catch(error => {
  console.error(error.message);
  process.exit(1);
});

module.exports = { verifyFactoryTransaction, verifyPristineVaultHistory, verifyChain };
