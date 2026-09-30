const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');

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

async function verifyFactoryTransaction(provider, expected, txHash, blockTag, label) {
  invariant(/^0x[0-9a-f]{64}$/i.test(txHash || ''), `${label} transaction hash missing`);
  const [transaction, receipt] = await Promise.all([
    provider.getTransaction(txHash), provider.getTransactionReceipt(txHash),
  ]);
  invariant(transaction && receipt, `${label} deployment transaction unavailable`);
  invariant(receipt.status === 1, `${label} deployment transaction failed`);
  invariant(receipt.blockNumber <= blockTag, `${label} deployment transaction is after anchor`);
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
  const [timelockCode, vaultCode, minDelay, proposer, executor, adminSelf, adminSafe,
    owner, paused, validators, threshold, activeChains, escrow, depositCap, payoutCap,
    depositVolume, payoutVolume, guardian, balance] = await Promise.all([
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

  const transactions = plan.deterministicDeployment.transactions;
  const provenance = [
    await verifyFactoryTransaction(provider, transactions[0], record.timelockTxHash, blockTag, `chain ${chain.chainId} Timelock`),
    await verifyFactoryTransaction(provider, transactions[1], record.vaultTxHash, blockTag, `chain ${chain.chainId} vault`),
  ];
  const recheck = await provider.getBlock(blockTag);
  invariant(recheck?.hash === anchor.hash, `chain ${chain.chainId} anchor changed during verification`);
  return { chainId: chain.chainId, blockNumber: blockTag, blockHash: anchor.hash, provenance, result: 'PASS' };
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

main().catch(error => {
  console.error(error.message);
  process.exit(1);
});
