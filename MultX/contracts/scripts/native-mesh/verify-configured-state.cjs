// O-27 review candidate. Read-only; never accepts a signer or sends a transaction.
const fs = require('fs');
const crypto = require('crypto');
const { ethers } = require('ethers');
const { verifySafe, verifyRoles } = require('../mainnet/verify-governance');
const { verifyFactoryTransaction } = require('./verify-paused-deployment.cjs');
const { verifyBytecodeEvidence } = require('./verify-bytecode-evidence.cjs');
const { auditVaultHistory, auditOperations, vaultABI, timelockABI } = require('./configured-history.cjs');
const hash = b => crypto.createHash('sha256').update(b).digest('hex');
const invariant = (ok, message) => { if (!ok) throw new Error(message); };
const codeHash = c => { invariant(/^0x(?:[a-f0-9]{2})+$/i.test(c), 'MISSING_CODE'); return hash(Buffer.from(c.slice(2), 'hex')); };
const same = (a, b) => a.toLowerCase() === b.toLowerCase();
const setEqual = (a, b) => a.length === b.length && [...a].map(x => x.toLowerCase()).sort().join() === [...b].map(x => x.toLowerCase()).sort().join();

class ReadOnlyProvider extends ethers.providers.JsonRpcProvider {
  async send(method, params) {
    invariant(['eth_chainId', 'eth_blockNumber', 'eth_getBlockByNumber', 'eth_getBlockByHash',
      'eth_getCode', 'eth_getStorageAt', 'eth_getBalance', 'eth_call', 'eth_getLogs',
      'eth_getTransactionByHash', 'eth_getTransactionReceipt'].includes(method), 'RPC_METHOD_NOT_READ_ONLY');
    const index = { eth_getCode: 1, eth_getBalance: 1, eth_call: 1, eth_getStorageAt: 2 }[method];
    if (this.anchor && index !== undefined && params[index] === ethers.utils.hexValue(this.anchor.number)) {
      params = [...params];
      params[index] = { blockHash: this.anchor.hash, requireCanonical: true };
    }
    return super.send(method, params);
  }
}

async function canonicalLogs(provider, address, start, end) {
  const result = [], ids = new Set(), receipts = new Map();
  for (let from = start; from <= end; from += 2000) {
    const logs = await provider.getLogs({ address, fromBlock: from, toBlock: Math.min(from + 1999, end) });
    for (const log of logs) {
      invariant(!log.removed && same(log.address, address) && log.blockNumber >= from &&
        log.blockNumber <= Math.min(from + 1999, end), 'INVALID_LOG_RANGE');
      const id = `${log.transactionHash}:${log.logIndex}`;
      invariant(!ids.has(id), 'DUPLICATE_LOG'); ids.add(id);
      if (!receipts.has(log.transactionHash)) {
        const receipt = await provider.getTransactionReceipt(log.transactionHash);
        invariant(receipt?.status === 1 && receipt.blockNumber <= end, 'INVALID_RECEIPT');
        const block = await provider.getBlock(receipt.blockNumber);
        invariant(block && same(block.hash, receipt.blockHash), 'NONCANONICAL_RECEIPT');
        receipts.set(log.transactionHash, receipt);
      }
      const receipt = receipts.get(log.transactionHash);
      invariant(same(receipt.blockHash, log.blockHash) && receipt.blockNumber === log.blockNumber &&
        receipt.logs.some(x => x.logIndex === log.logIndex && same(x.address, log.address) &&
          x.data === log.data && JSON.stringify(x.topics) === JSON.stringify(log.topics)), 'LOG_RECEIPT_MISMATCH');
      result.push(log);
    }
  }
  for (const receipt of receipts.values()) {
    for (const log of receipt.logs.filter(x => same(x.address, address))) {
      invariant(ids.has(`${log.transactionHash}:${log.logIndex}`), 'OMITTED_RECEIPT_LOG');
    }
  }
  return result.sort((a, b) => a.blockNumber - b.blockNumber || a.logIndex - b.logIndex);
}

async function verifyConfiguredChain(provider, plan, chain, expected) {
  invariant(Number(BigInt(await provider.send('eth_chainId', []))) === chain.chainId, 'WRONG_CHAIN');
  const anchor = await provider.getBlock('finalized');
  invariant(anchor?.hash && Number.isSafeInteger(anchor.number), 'FINALIZED_ANCHOR_REQUIRED');
  provider.anchor = anchor;
  const tag = { blockTag: anchor.number }, addresses = plan.deterministicDeployment;
  const vault = new ethers.Contract(addresses.vaultAddress, vaultABI, provider);
  const timelock = new ethers.Contract(addresses.timelockAddress, timelockABI, provider);
  for (const [address, digest] of [[addresses.factory, chain.runtimeIdentities.deterministicFactoryRuntimeSha256],
    [vault.address, plan.release.vaultRuntimeSha256], [timelock.address, plan.release.timelockRuntimeSha256]]) {
    invariant(codeHash(await provider.getCode(address, anchor.number)) === digest, 'RUNTIME_MISMATCH');
  }
  await verifySafe(provider, plan.governance.safe, { ...plan.governance.safePolicy,
    implementation: chain.safeImplementation, proxyRuntimeSha256: chain.runtimeIdentities.safeProxyRuntimeSha256,
    implementationRuntimeSha256: chain.runtimeIdentities.safeImplementationRuntimeSha256,
    fallbackHandlerRuntimeSha256: chain.runtimeIdentities.fallbackHandlerRuntimeSha256,
  }, anchor.number, codeHash, (a, abi, p) => new ethers.Contract(a, abi, p), chain.chainId);
  const provenance = [];
  for (const [i, tx, address, digest] of [[0, expected.timelockTxHash, timelock.address, plan.release.timelockRuntimeSha256],
    [1, expected.vaultTxHash, vault.address, plan.release.vaultRuntimeSha256]]) {
    provenance.push(await verifyFactoryTransaction(provider, addresses.transactions[i], tx, anchor.number,
      'deployment', address, digest, chain.confirmations));
  }
  const timelockLogs = await canonicalLogs(provider, timelock.address, provenance[0].blockNumber, anchor.number);
  await verifyRoles(provider, timelock, { proposers: [plan.governance.safe], executors: [plan.governance.safe],
    cancellers: [plan.governance.safe], admins: [timelock.address] }, provenance[0].blockNumber, anchor.number,
  async (_p, _a, _from, _to, topics) => timelockLogs.filter(x => topics[0].includes(x.topics[0])));
  invariant((await timelock.getMinDelay(tag)).eq(172800), 'TIMELOCK_DELAY_CHANGED');
  invariant(same(await vault.owner(tag), timelock.address), 'OWNER_CHANGED');
  invariant(await vault.paused(tag) === true, 'VAULT_NOT_PAUSED');
  invariant(setEqual(await vault.getValidators(tag), plan.bridgeSignerSet.addresses), 'VALIDATORS_CHANGED');
  invariant((await vault.signaturesRequired(tag)).eq(3), 'QUORUM_CHANGED');
  invariant(same(await vault.pauseGuardian(tag), plan.governance.safe), 'GUARDIAN_CHANGED');
  for (const method of ['outstandingEscrow', 'depositVolume', 'payoutVolume']) {
    invariant((await vault[method](tag)).isZero(), 'NONZERO_ACTIVITY');
  }
  invariant((await vault.dailyDepositCap(tag)).eq(expected.depositCapWei) &&
    (await vault.dailyPayoutCap(tag)).eq(expected.payoutCapWei), 'CAPS_CHANGED');
  invariant((await vault.activeChainCount(tag)).eq(2), 'ROUTE_COUNT_CHANGED');
  const remotes = [1, 56, 8453].filter(x => x !== chain.chainId);
  for (const id of remotes) {
    invariant(await vault.supportedChains(id, tag) && same(await vault.sourceVaults(id, tag), vault.address) &&
      (await vault.routeFinalityDelaySeconds(id, tag)).eq(3600), 'ROUTE_CHANGED');
  }
  const vaultLogs = await canonicalLogs(provider, vault.address, provenance[1].blockNumber, anchor.number);
  const history = auditVaultHistory(vaultLogs, expected, plan, chain.chainId);
  const balance = await provider.getBalance(vault.address, anchor.number);
  invariant(balance.eq(history.fundingWei), 'UNRECONCILED_BALANCE');
  const operations = await auditOperations(timelockLogs, timelock, anchor, expected);
  const recheck = await provider.getBlock(anchor.number);
  invariant(recheck && same(recheck.hash, anchor.hash), 'ANCHOR_CHANGED');
  return { chainId: chain.chainId, result: operations.some(x => x.requiresIndependentReview) ? 'HOLD' : 'PASS', anchor: { number: anchor.number, hash: anchor.hash },
    provenance, balanceWei: balance.toString(), history, operations,
    historySha256: hash(Buffer.from(JSON.stringify({ vaultLogs, timelockLogs }))),
    unpauseAuthorized: false, transactionsSent: false };
}

function readPinned(file, digest) {
  invariant(/^[a-f0-9]{64}$/.test(digest || ''), 'EXPECTED_SHA256_REQUIRED');
  const bytes = fs.readFileSync(file); invariant(hash(bytes) === digest, 'INPUT_HASH_MISMATCH');
  return { bytes, data: JSON.parse(bytes) };
}
async function main() {
  invariant(process.argv.length === 8, 'USAGE_PLAN_SHA_EXPECTATIONS_SHA_BYTECODE_SHA');
  const [planFile, planSha, expectedFile, expectedSha, bytecodeFile, bytecodeSha] = process.argv.slice(2);
  const plan = readPinned(planFile, planSha).data;
  const expected = readPinned(expectedFile, expectedSha).data;
  const bytecode = readPinned(bytecodeFile, bytecodeSha);
  verifyBytecodeEvidence(plan, bytecode.bytes, bytecodeSha);
  invariant(expected.planSha256 === planSha && expected.enabled === false, 'INVALID_EXPECTATION_BINDING');
  for (const records of [plan.chains, expected.chains]) invariant(Array.isArray(records) &&
    records.map(x => x.chainId).sort((a, b) => a - b).join() === '1,56,8453', 'EXACT_CHAINS_REQUIRED');
  const results = [];
  for (const chain of plan.chains) {
    const url = process.env[`MULTX_RPC_${chain.chainId}`]; invariant(url, 'PRIVATE_RPC_REQUIRED');
    const provider = new ReadOnlyProvider({ url, timeout: 20000 });
    results.push(await verifyConfiguredChain(provider, plan, chain, expected.chains.find(x => x.chainId === chain.chainId)));
  }
  const result = results.every(x => x.result === 'PASS') ? 'PASS' : 'HOLD';
  console.log(JSON.stringify({ result, planSha256: planSha, expectationsSha256: expectedSha,
    bytecodeSha256: bytecodeSha, executionUTC: new Date().toISOString(), results, transactionsSent: false }, null, 2));
  if (result !== 'PASS') process.exitCode = 1;
}
if (require.main === module) main().catch(() => {
  // RPC exceptions can contain credential-bearing URLs. Never print them.
  console.error(JSON.stringify({ result: 'FAIL', reason: 'CONFIGURED_STATE_VERIFICATION_FAILED', transactionsSent: false }));
  process.exitCode = 1;
});
module.exports = { verifyConfiguredChain, canonicalLogs, ReadOnlyProvider, readPinned };
