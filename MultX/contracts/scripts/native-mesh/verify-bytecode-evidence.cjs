const crypto = require('crypto');
const fs = require('fs');
const { ethers } = require('ethers');

const factory = new ethers.utils.Interface([
  'function deploy(bytes _initCode,bytes32 _salt) returns(address payable createdContract)',
]);
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const hashCode = value => digest(Buffer.from(value.slice(2), 'hex'));
const isHash = value => /^[0-9a-f]{64}$/i.test(value || '');

function verifyBytecodeEvidence(plan, evidenceBytes, expectedSha256) {
  if (!isHash(expectedSha256) || digest(evidenceBytes) !== expectedSha256.toLowerCase()) {
    throw new Error('independently approved bytecode evidence SHA-256 mismatch');
  }
  const evidence = JSON.parse(evidenceBytes);
  if (evidence.schemaVersion !== 1 || !/^[0-9a-f]{40}$/.test(evidence.commit || '') ||
      evidence.commit !== plan.release?.commit) {
    throw new Error('bytecode evidence release commit mismatch');
  }
  const specifications = [
    ['govTimelock', 'timelockCreationSha256', 'timelockRuntimeSha256', 'timelockSalt'],
    ['nativeLiquidityVault', 'vaultCreationSha256', 'vaultRuntimeSha256', 'vaultSalt'],
  ];
  if (!Array.isArray(plan.deterministicDeployment?.transactions) ||
      plan.deterministicDeployment.transactions.length !== specifications.length) {
    throw new Error('exact two reviewed creation transactions required');
  }
  for (let index = 0; index < specifications.length; index++) {
    const [key, creationField, runtimeField, saltField] = specifications[index];
    const record = evidence.contracts?.[key];
    const transaction = plan.deterministicDeployment.transactions[index];
    if (!record || !/^0x[0-9a-f]+$/i.test(record.creationBytecode || '') ||
        !isHash(record.creationSha256) || !isHash(record.runtimeSha256) ||
        record.solcVersion !== '0.8.24+commit.e11b9ed9' ||
        record.settings?.optimizer?.enabled !== true || record.settings.optimizer.runs !== 200 ||
        record.settings.evmVersion !== 'paris' ||
        hashCode(record.creationBytecode) !== record.creationSha256) {
      throw new Error(`${key} independent source/build evidence is invalid`);
    }
    let parsed;
    try { parsed = factory.parseTransaction({ data: transaction.data }); }
    catch { throw new Error(`${key} deployment calldata is not factory deploy`); }
    const initCode = parsed.args._initCode;
    if (transaction.to?.toLowerCase() !== plan.deterministicDeployment.factory?.toLowerCase() ||
        parsed.args._salt.toLowerCase() !== plan.deterministicDeployment[saltField]?.toLowerCase() ||
        !initCode.toLowerCase().startsWith(record.creationBytecode.toLowerCase()) ||
        hashCode(initCode) !== plan.release[creationField] ||
        record.runtimeSha256 !== plan.release[runtimeField]) {
      throw new Error(`${key} reviewed creation/runtime identity mismatch`);
    }
  }
  return { evidenceSha256: expectedSha256.toLowerCase(), commit: evidence.commit };
}

function loadBytecodeEvidence(plan, file, expectedSha256) {
  if (!file) throw new Error('--bytecode-evidence is required');
  return verifyBytecodeEvidence(plan, fs.readFileSync(file), expectedSha256);
}

module.exports = { verifyBytecodeEvidence, loadBytecodeEvidence };
