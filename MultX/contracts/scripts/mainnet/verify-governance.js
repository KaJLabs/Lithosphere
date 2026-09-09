const { ethers } = require('ethers');
const { sameSet } = require('./governance-policy');
const ROLE_ABI = [
  'event RoleGranted(bytes32 indexed role,address indexed account,address indexed sender)',
  'event RoleRevoked(bytes32 indexed role,address indexed account,address indexed sender)',
  'function hasRole(bytes32,address) view returns(bool)',
  'function getMinDelay() view returns(uint256)',
];
const iface = new ethers.utils.Interface(ROLE_ABI);
const ROLES = { proposers: ethers.utils.id('PROPOSER_ROLE'), executors: ethers.utils.id('EXECUTOR_ROLE'),
  cancellers: ethers.utils.id('CANCELLER_ROLE'), admins: ethers.constants.HashZero };
const SAFE_ABI = [
  'function VERSION() view returns(string)', 'function getOwners() view returns(address[])',
  'function getThreshold() view returns(uint256)',
  'function getModulesPaginated(address,uint256) view returns(address[],address)',
];
const SENTINEL = '0x0000000000000000000000000000000000000001';
const GUARD_SLOT = ethers.utils.id('guard_manager.guard.address');
const FALLBACK_SLOT = ethers.utils.id('fallback_manager.handler.address');
const storageAddress = value => {
  if (!/^0x0{24}[0-9a-f]{40}$/i.test(value)) throw new Error('noncanonical Safe address storage');
  return '0x' + value.slice(-40);
};

async function verifyRoles(provider, timelock, approved, fromBlock, blockTag, getLogs) {
  const logs = await getLogs(provider, timelock.address, fromBlock, blockTag,
    [[iface.getEventTopic('RoleGranted'), iface.getEventTopic('RoleRevoked')]]);
  const roles = new Map();
  const touched = new Map();
  for (const log of [...logs].sort((a,b) => a.blockNumber-b.blockNumber || a.transactionIndex-b.transactionIndex || a.logIndex-b.logIndex)) {
    if (log.removed) throw new Error('removed governance log');
    const event = iface.parseLog(log);
    const role = event.args.role.toLowerCase(), account = event.args.account.toLowerCase();
    if (!roles.has(role)) { roles.set(role, new Set()); touched.set(role, new Set()); }
    touched.get(role).add(account);
    if (event.name === 'RoleGranted') roles.get(role).add(account); else roles.get(role).delete(account);
  }
  for (const [name, role] of Object.entries(ROLES)) {
    const members = [...(roles.get(role) || [])];
    if (!sameSet(members, approved[name])) throw new Error(`exact timelock ${name} role set mismatch`);
  }
  for (const [role, members] of roles) {
    if (!Object.values(ROLES).includes(role) && members.size) throw new Error('undeclared timelock role');
    for (const account of touched.get(role)) {
      if (await timelock.hasRole(role, account, { blockTag }) !== members.has(account)) throw new Error('timelock role history/state mismatch');
    }
  }
}

async function verifySafe(provider, safeAddress, policy, blockTag, hashCode, contractFactory) {
  const [proxy, singletonSlot, singleton] = await Promise.all([
    provider.getCode(safeAddress, blockTag), provider.getStorageAt(safeAddress, 0, blockTag),
    provider.getCode(policy.implementation, blockTag),
  ]);
  if (proxy === '0x' || singleton === '0x' || hashCode(proxy) !== policy.proxyRuntimeSha256.toLowerCase() ||
      hashCode(singleton) !== policy.implementationRuntimeSha256.toLowerCase() ||
      storageAddress(singletonSlot).toLowerCase() !== policy.implementation.toLowerCase()) throw new Error('Safe bytecode/implementation mismatch');
  const safe = contractFactory(safeAddress, SAFE_ABI, provider);
  const [version, owners, threshold, modules, guard, fallback] = await Promise.all([
    safe.VERSION({ blockTag }), safe.getOwners({ blockTag }), safe.getThreshold({ blockTag }),
    safe.getModulesPaginated(SENTINEL, 1, { blockTag }),
    provider.getStorageAt(safeAddress, GUARD_SLOT, blockTag), provider.getStorageAt(safeAddress, FALLBACK_SLOT, blockTag),
  ]);
  if (version !== policy.version || !sameSet(owners, policy.owners) || threshold.toString() !== String(policy.threshold) ||
      modules[0].length !== 0 || modules[1].toLowerCase() !== SENTINEL ||
      storageAddress(guard).toLowerCase() !== policy.guard.toLowerCase() ||
      storageAddress(fallback).toLowerCase() !== policy.fallbackHandler.toLowerCase()) throw new Error('Safe authority state mismatch');
}

async function verifyGovernance(provider, chain, approved, evidence, blockTag, helpers,
  contractFactory = (a,b,p) => new ethers.Contract(a,b,p)) {
  const record = chain.governance;
  if (record.timelockDeploymentBlock > blockTag) throw new Error('timelock created after verification block');
  await helpers.verifyCreationProvenance(provider, approved.timelock, record.timelockDeploymentTxHash,
    record.timelockDeploymentBlock, `${chain.name} timelock`, approved.governance.timelock.deployer,
    evidence.contracts.govTimelock.creationBytecode);
  const transaction = await provider.getTransaction(record.timelockDeploymentTxHash);
  const t = approved.governance.timelock;
  const expectedInput = evidence.contracts.govTimelock.creationBytecode + ethers.utils.defaultAbiCoder.encode(
    ['uint256','address[]','address[]','address'],
    [approved.timelockDelaySeconds, t.proposers, t.executors, t.constructorAdmin]).slice(2);
  if (transaction.to != null || transaction.data.toLowerCase() !== expectedInput.toLowerCase()) throw new Error('timelock constructor arguments mismatch');
  const code = await provider.getCode(approved.timelock, blockTag);
  if (code === '0x' || helpers.sha256Code(code) !== evidence.contracts.govTimelock.runtimeSha256.toLowerCase()) throw new Error('timelock audited runtime mismatch');
  const timelock = contractFactory(approved.timelock, ROLE_ABI, provider);
  if ((await timelock.getMinDelay({ blockTag })).toString() !== String(approved.timelockDelaySeconds)) throw new Error('timelock delay mismatch');
  await verifyRoles(provider, timelock, t, record.timelockDeploymentBlock, blockTag, helpers.getLogsByTopics);
  await verifySafe(provider, approved.safe, approved.governance.safe, blockTag, helpers.sha256Code, contractFactory);
}
module.exports = { verifyGovernance, verifyRoles, verifySafe, ROLE_ABI, ROLES, GUARD_SLOT, FALLBACK_SLOT };
