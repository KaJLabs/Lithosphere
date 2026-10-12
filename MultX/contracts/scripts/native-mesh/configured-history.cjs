const { ethers } = require('ethers');
const check = (ok, message) => { if (!ok) throw new Error(message); };
const same = (a, b) => a.toLowerCase() === b.toLowerCase();
const vaultABI = [
  'function owner() view returns(address)', 'function paused() view returns(bool)',
  'function getValidators() view returns(address[])', 'function signaturesRequired() view returns(uint256)',
  'function pauseGuardian() view returns(address)', 'function outstandingEscrow() view returns(uint256)',
  'function dailyDepositCap() view returns(uint256)', 'function dailyPayoutCap() view returns(uint256)',
  'function depositVolume() view returns(uint256)', 'function payoutVolume() view returns(uint256)',
  'function activeChainCount() view returns(uint256)', 'function supportedChains(uint256) view returns(bool)',
  'function sourceVaults(uint256) view returns(address)', 'function routeFinalityDelaySeconds(uint256) view returns(uint64)',
  'event OwnershipTransferred(address indexed previousOwner,address indexed newOwner)',
  'event ValidatorSetUpdated(address[] validators)', 'event Paused(address account)',
  'event RouteSet(uint256 indexed chainId,address indexed sourceVault,uint64 finalityDelaySeconds,bool supported)',
  'event DailyCapsSet(uint256 depositCap,uint256 payoutCap)',
  'event PauseGuardianUpdated(address indexed previousGuardian,address indexed newGuardian)',
  'event LiquidityFunded(address indexed funder,uint256 amount)',
];
const timelockABI = [
  'function getMinDelay() view returns(uint256)', 'function hasRole(bytes32,address) view returns(bool)',
  'function getTimestamp(bytes32) view returns(uint256)',
  'event CallScheduled(bytes32 indexed id,uint256 indexed index,address target,uint256 value,bytes data,bytes32 predecessor,uint256 delay)',
  'event CallExecuted(bytes32 indexed id,uint256 indexed index,address target,uint256 value,bytes data)',
  'event CallSalt(bytes32 indexed id,bytes32 salt)', 'event Cancelled(bytes32 indexed id)',
  'event MinDelayChange(uint256 oldDuration,uint256 newDuration)',
  'event RoleGranted(bytes32 indexed role,address indexed account,address indexed sender)',
  'event RoleRevoked(bytes32 indexed role,address indexed account,address indexed sender)',
];
const vi = new ethers.utils.Interface(vaultABI), ti = new ethers.utils.Interface(timelockABI);
function encoded(event, args) {
  const e = vi.encodeEventLog(vi.getEvent(event), args);
  return JSON.stringify([e.topics.map(x => x.toLowerCase()), e.data.toLowerCase()]);
}
function auditVaultHistory(logs, expected, plan, chainId) {
  const d = plan.deterministicDeployment, zero = ethers.constants.AddressZero;
  const required = new Map();
  function add(tx, event, args) {
    const key = tx.toLowerCase() + ':' + encoded(event, args);
    check(!required.has(key), 'DUPLICATE_EXPECTED_EVENT'); required.set(key, false);
  }
  add(expected.vaultTxHash, 'OwnershipTransferred', [zero, d.timelockAddress]);
  add(expected.vaultTxHash, 'ValidatorSetUpdated', [plan.bridgeSignerSet.addresses]);
  add(expected.vaultTxHash, 'Paused', [d.factory]);
  add(expected.configurationTxHash, 'PauseGuardianUpdated', [zero, plan.governance.safe]);
  add(expected.configurationTxHash, 'DailyCapsSet', [expected.depositCapWei, expected.payoutCapWei]);
  for (const remote of [1, 56, 8453].filter(x => x !== chainId)) {
    add(expected.configurationTxHash, 'RouteSet', [remote, d.vaultAddress, 3600, true]);
  }
  let funding = ethers.BigNumber.from(0);
  for (const entry of expected.funding) {
    add(entry.transactionHash, 'LiquidityFunded', [entry.funder, entry.amountWei]);
    funding = funding.add(entry.amountWei);
  }
  check(logs.length === required.size, 'VAULT_HISTORY_COUNT_MISMATCH');
  for (const log of logs) {
    const key = log.transactionHash.toLowerCase() + ':' + JSON.stringify([log.topics.map(x => x.toLowerCase()), log.data.toLowerCase()]);
    check(required.has(key) && !required.get(key), 'UNAPPROVED_VAULT_EVENT'); required.set(key, true);
  }
  check([...required.values()].every(Boolean), 'MISSING_VAULT_EVENT');
  return { events: logs.length, fundingWei: funding.toString(), noDeposits: true };
}

async function auditOperations(logs, timelock, anchor, expected) {
  const groups = new Map(), executions = new Map(), active = new Map();
  for (const log of logs) {
    const parsed = ti.parseLog(log), a = parsed.args;
    if (parsed.name === 'CallScheduled') {
      const key = `${a.id}:${log.transactionHash}`;
      if (!groups.has(key)) groups.set(key, { id: a.id, tx: log.transactionHash, calls: [],
        predecessor: a.predecessor, delay: a.delay.toString(), salt: ethers.constants.HashZero, log });
      const g = groups.get(key);
      check(a.index.eq(g.calls.length) && a.predecessor === g.predecessor && a.delay.eq(g.delay), 'INVALID_SCHEDULE_GROUP');
      if (a.index.isZero()) { check(!active.has(a.id), 'RESCHEDULE_WITHOUT_CANCEL'); active.set(a.id, g); }
      g.calls.push({ target: a.target, valueWei: a.value.toString(), calldata: a.data });
    } else if (parsed.name === 'CallSalt') {
      const g = groups.get(`${a.id}:${log.transactionHash}`);
      check(g && !g.saltSeen, 'INVALID_SALT_EVENT'); g.salt = a.salt; g.saltSeen = true;
    } else if (parsed.name === 'Cancelled') {
      check(active.has(a.id), 'CANCEL_WITHOUT_SCHEDULE'); active.get(a.id).cancelled = true;
      active.get(a.id).cancellationTx = log.transactionHash; active.delete(a.id);
    } else if (parsed.name === 'CallExecuted') {
      const g = active.get(a.id); check(g && !g.cancelled, 'EXECUTION_WITHOUT_SCHEDULE');
      const c = g.calls[a.index.toNumber()];
      check(c && same(c.target, a.target) && a.value.eq(c.valueWei) && c.calldata === a.data, 'EXECUTION_CALL_CHANGED');
      const key = `${a.id}:${log.transactionHash}`;
      if (!executions.has(key)) executions.set(key, []);
      const indices = executions.get(key); check(a.index.eq(indices.length), 'EXECUTION_INDEX_GAP'); indices.push(a.index.toNumber());
      g.executionTx = log.transactionHash;
      if (indices.length === g.calls.length) { g.done = true; active.delete(a.id); }
    } else if (parsed.name === 'MinDelayChange') {
      check(a.oldDuration.isZero() && a.newDuration.eq(172800) && same(log.transactionHash, expected.timelockTxHash), 'DELAY_HISTORY_CHANGED');
    }
  }
  const results = [];
  for (const g of groups.values()) {
    const targets = g.calls.map(x => x.target), values = g.calls.map(x => x.valueWei), data = g.calls.map(x => x.calldata);
    const batch = ethers.utils.keccak256(ethers.utils.defaultAbiCoder.encode(
      ['address[]', 'uint256[]', 'bytes[]', 'bytes32', 'bytes32'], [targets, values, data, g.predecessor, g.salt]));
    const single = g.calls.length === 1 ? ethers.utils.keccak256(ethers.utils.defaultAbiCoder.encode(
      ['address', 'uint256', 'bytes', 'bytes32', 'bytes32'], [targets[0], values[0], data[0], g.predecessor, g.salt])) : null;
    check(g.id === batch || g.id === single, 'OPERATION_HASH_MISMATCH');
    const known = expected.operations.find(x => same(x.id, g.id));
    if (known) {
      check(same(known.scheduleTxHash, g.tx), 'SCHEDULE_TRANSACTION_CHANGED');
      check(!g.done || (known.executionTxHash && same(known.executionTxHash, g.executionTx)), 'UNAPPROVED_EXECUTION');
      if (known.executionTxHash) check(g.done && same(g.executionTx, known.executionTxHash), 'MISSING_APPROVED_EXECUTION');
    }
    const timestamp = await timelock.getTimestamp(g.id, { blockTag: anchor.number });
    // An id may be cancelled and rescheduled. Compare storage against the most recent lifecycle only.
    const latest = [...groups.values()].filter(x => x.id === g.id).at(-1);
    if (latest === g) {
      check(g.done ? timestamp.eq(1) : g.cancelled ? timestamp.isZero() : timestamp.gt(1), 'OPERATION_HISTORY_STATE_MISMATCH');
    }
    results.push({ id: g.id, scheduleTransactionHash: g.tx, executionTransactionHash: g.executionTx || null,
      cancellationTransactionHash: g.cancellationTx || null,
      state: g.done ? 'DONE' : g.cancelled ? 'CANCELLED' : timestamp.lte(anchor.timestamp) ? 'READY' : 'WAITING',
      timestamp: timestamp.toString(), predecessor: g.predecessor, salt: g.salt,
      calls: g.calls.map(c => ({ ...c, calldataHash: ethers.utils.keccak256(c.calldata) })),
      recognized: Boolean(known), requiresIndependentReview: !known, unpauseAuthorized: false });
  }
  for (const known of expected.operations) check(results.some(x => same(x.id, known.id)), 'MISSING_RECORDED_OPERATION');
  return results;
}
module.exports = { vaultABI, timelockABI, auditVaultHistory, auditOperations };
