const { expect } = require('chai');
const { ethers } = require('ethers');
const { verifyRoles, verifyGovernance, ROLES, ROLE_ABI } = require('../scripts/mainnet/verify-governance');
const { verifyTokenUniverse, sha256Code } = require('../scripts/mainnet/verify-deployment-readonly');
const { governance } = require('./governance-fixture');
const a = n => '0x' + n.toString(16).padStart(40, '0');
const iface = new ethers.utils.Interface(ROLE_ABI);
async function rejects(promise, message) {
  let error;
  try { await promise; } catch (e) { error = e; }
  expect(error, message).to.be.instanceOf(Error);
  expect(error.message).to.include(message);
}
function roleFixture() {
  const policy = governance(a(10), a(11), a(12)).timelock;
  const logs = [];
  const live = new Set();
  function event(name, role, account) {
    const encoded = iface.encodeEventLog(iface.getEvent(name), [role, account, a(12)]);
    logs.push({ ...encoded, blockNumber: 1, transactionIndex: 0, logIndex: logs.length });
    const key = role.toLowerCase() + account.toLowerCase();
    if (name === 'RoleGranted') live.add(key); else live.delete(key);
  }
  for (const [name, role] of Object.entries(ROLES)) for (const account of policy[name]) event('RoleGranted', role, account);
  const timelock = { address: a(11), hasRole: async (role, account) => live.has(role.toLowerCase() + account.toLowerCase()) };
  return { logs, live, event, run: () => verifyRoles({}, timelock, policy, 1, 9, async () => logs) };
}
describe('Autha L-02 isolated governance and token negatives', function () {
  it('rejects an undeclared active role but accepts its fully revoked history', async function () {
    const f = roleFixture(), role = ethers.utils.id('UNDECLARED');
    await f.run(); f.event('RoleGranted', role, a(99));
    await rejects(f.run(), 'undeclared timelock role');
    f.event('RoleRevoked', role, a(99)); await f.run();
  });
  it('rejects history granting an expected role that live state denies', async function () {
    const f = roleFixture(); await f.run(); f.live.delete(ROLES.proposers.toLowerCase() + a(10));
    await rejects(f.run(), 'timelock role history/state mismatch');
  });
  it('rejects a revoked account still holding its role in live state', async function () {
    const f = roleFixture(); f.event('RoleGranted', ROLES.proposers, a(99)); f.event('RoleRevoked', ROLES.proposers, a(99));
    await f.run(); f.live.add(ROLES.proposers.toLowerCase() + a(99));
    await rejects(f.run(), 'timelock role history/state mismatch');
  });
  it('rejects reorg-removed logs even when replayed roles and live state agree', async function () {
    const f = roleFixture(); await f.run(); f.logs[0].removed = true;
    await rejects(f.run(), 'removed governance log');
  });
  it('rejects only the live minimum-delay drift after valid creation and runtime checks', async function () {
    const policy = governance(a(10), a(11), a(12));
    const approved = { safe: a(10), timelock: a(11), timelockDelaySeconds: 172800, governance: policy };
    const data = '0x6000' + ethers.utils.defaultAbiCoder.encode(['uint256','address[]','address[]','address'],
      [172800, policy.timelock.proposers, policy.timelock.executors, policy.timelock.constructorAdmin]).slice(2);
    const provider = { getTransaction: async () => ({ to: null, data }), getCode: async () => '0x6001' };
    const helpers = { verifyCreationProvenance: async () => 1, sha256Code, getLogsByTopics: async () => [] };
    await rejects(verifyGovernance(provider, { name: 'test', governance: { timelockDeploymentBlock: 1 } }, approved,
      { contracts: { govTimelock: { creationBytecode: '0x6000', runtimeSha256: sha256Code('0x6001') } } }, 9, helpers,
      () => ({ getMinDelay: async () => 1 })), 'timelock delay mismatch');
  });
  for (const enabled of [true, false]) {
    it(`rejects token history/live disagreement for a historically ${enabled ? 'enabled' : 'removed'} token`, async function () {
      const tokenIface = new ethers.utils.Interface(['event SupportedTokenSet(address indexed token,bool supported)']);
      const logs = [true, ...(enabled ? [] : [false])].map((state, index) => ({
        ...tokenIface.encodeEventLog(tokenIface.getEvent('SupportedTokenSet'), [a(99), state]),
        blockNumber: 1, transactionIndex: 0, logIndex: index,
      }));
      const chain = { name: 'test', bridge: { address: a(11), deploymentBlock: 1 }, assets: enabled ? [{ address: a(99) }] : [] };
      await verifyTokenUniverse({ getLogs: async () => logs }, { supportedTokens: async () => enabled }, chain, 9);
      await rejects(verifyTokenUniverse({ getLogs: async () => logs }, { supportedTokens: async () => !enabled }, chain, 9), 'supported-token history/state mismatch');
    });
  }
});
