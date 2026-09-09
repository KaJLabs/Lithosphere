const { ethers } = require('ethers');
const ZERO = ethers.constants.AddressZero;
const sameSet = (a, b) => a.map(x => x.toLowerCase()).sort().join(',') === b.map(x => x.toLowerCase()).sort().join(',');
const address = (value, zero = false) => {
  if (!ethers.utils.isAddress(value) || (!zero && value.toLowerCase() === ZERO)) throw new Error('invalid governance address');
};
const hash = value => {
  if (!/^[a-f0-9]{64}$/i.test(value || '') || /^0{64}$/.test(value)) throw new Error('governance runtime SHA-256 required');
};
function validateGovernancePolicy(chain) {
  const g = chain.governance;
  if (!g || !g.timelock || !g.safe) throw new Error('complete governance policy required');
  const t = g.timelock;
  address(t.deployer);
  for (const name of ['proposers', 'executors', 'cancellers', 'admins']) {
    if (!Array.isArray(t[name]) || t[name].length !== 1) throw new Error(`exact timelock ${name} policy required`);
    t[name].forEach(x => address(x, name === 'executors'));
  }
  if (!sameSet(t.proposers, [chain.safe]) || !sameSet(t.cancellers, [chain.safe]) ||
      !sameSet(t.admins, [chain.timelock]) ||
      !(sameSet(t.executors, [chain.safe]) || sameSet(t.executors, [ZERO])) || t.constructorAdmin !== ZERO) {
    throw new Error('timelock policy must be Safe-controlled and self-administered');
  }
  const s = g.safe;
  // Explicit supported layout, no unreviewed module/guard/fallback execution paths.
  if (s.version !== '1.4.1') throw new Error('only reviewed Safe 1.4.1 storage layout supported');
  address(s.implementation);
  hash(s.proxyRuntimeSha256); hash(s.implementationRuntimeSha256);
  if (!Array.isArray(s.owners) || s.owners.length < 2 || s.owners.length > 100) throw new Error('Safe owner set required');
  s.owners.forEach(x => address(x));
  if (new Set(s.owners.map(x => x.toLowerCase())).size !== s.owners.length ||
      !Number.isInteger(s.threshold) || s.threshold < 2 || s.threshold > s.owners.length) throw new Error('invalid Safe owner threshold');
  if (!Array.isArray(s.modules) || s.modules.length || s.guard !== ZERO || s.fallbackHandler !== ZERO) {
    throw new Error('Safe modules, guard and fallback handler must be disabled for this release');
  }
  const approval = new URL(s.approvalRecordUrl);
  if (approval.protocol !== 'https:' || approval.username || approval.password) throw new Error('Safe independent acceptance URL required');
}
module.exports = { validateGovernancePolicy, sameSet };
