const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { ethers } = require('hardhat');
const { verifyBytecodeEvidence } = require('../scripts/native-mesh/verify-bytecode-evidence.cjs');

const factory = new ethers.utils.Interface([
  'function deploy(bytes _initCode,bytes32 _salt) returns(address payable createdContract)',
]);
const hash = code => crypto.createHash('sha256').update(Buffer.from(code.slice(2), 'hex')).digest('hex');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const build = () => {
  const commit = 'a'.repeat(40);
  const specs = [
    ['govTimelock', 'timelock', '0x6001', '0x6001aa', '0x6003'],
    ['nativeLiquidityVault', 'vault', '0x6002', '0x6002bb', '0x6004'],
  ];
  const release = { commit };
  const deployment = { factory: '0x1111111111111111111111111111111111111111', transactions: [] };
  const evidence = { schemaVersion: 1, commit, contracts: {} };
  for (const [name, prefix, creation, initCode, runtime] of specs) {
    const salt = ethers.utils.id(name);
    release[`${prefix}CreationSha256`] = hash(initCode);
    release[`${prefix}RuntimeSha256`] = hash(runtime);
    deployment[`${prefix}Salt`] = salt;
    deployment.transactions.push({ to: deployment.factory, data: factory.encodeFunctionData('deploy', [initCode, salt]) });
    evidence.contracts[name] = {
      creationBytecode: creation, creationSha256: hash(creation), runtimeSha256: hash(runtime),
      solcVersion: '0.8.24+commit.e11b9ed9',
      settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: 'paris' },
    };
  }
  return { plan: { release, deterministicDeployment: deployment }, evidence };
};
const verify = ({ plan, evidence }, approvedSha) => {
  const bytes = Buffer.from(JSON.stringify(evidence));
  return verifyBytecodeEvidence(plan, bytes, approvedSha || sha(bytes));
};

describe('Native mesh independent bytecode evidence', function () {
  it('binds approved source evidence to both exact factory transactions and runtime identities', function () {
    const fixture = build();
    assert.equal(verify(fixture).commit, fixture.plan.release.commit);
    assert.throws(() => verify(fixture, '0'.repeat(64)), /approved bytecode evidence SHA-256 mismatch/);
    fixture.evidence.commit = 'b'.repeat(40);
    assert.throws(() => verify(fixture), /release commit mismatch/);
    fixture.evidence.commit = fixture.plan.release.commit;
    fixture.evidence.contracts.govTimelock.creationBytecode = '0x6009';
    assert.throws(() => verify(fixture), /independent source\/build evidence is invalid/);
  });

  it('rejects changed constructor bytes, salts, and runtime hashes', function () {
    const fixture = build();
    fixture.plan.deterministicDeployment.transactions[0].data = factory.encodeFunctionData('deploy',
      ['0x6001ab', fixture.plan.deterministicDeployment.timelockSalt]);
    assert.throws(() => verify(fixture), /reviewed creation\/runtime identity mismatch/);
    fixture.plan.deterministicDeployment.transactions[0].data = factory.encodeFunctionData('deploy',
      ['0x6001aa', ethers.utils.id('wrong-salt')]);
    assert.throws(() => verify(fixture), /reviewed creation\/runtime identity mismatch/);
    fixture.plan.deterministicDeployment.transactions[0].data = factory.encodeFunctionData('deploy',
      ['0x6001aa', fixture.plan.deterministicDeployment.timelockSalt]);
    fixture.plan.release.vaultRuntimeSha256 = '0'.repeat(64);
    assert.throws(() => verify(fixture), /reviewed creation\/runtime identity mismatch/);
  });
});
