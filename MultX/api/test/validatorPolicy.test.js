import test from 'node:test';
import assert from 'node:assert/strict';

import {
  positiveSafeInteger,
  validateProductionSignerEnvironment,
  validateValidatorSet,
  verifyLiveValidatorTopology,
} from '../src/services/validatorPolicy.js';

const A = '0x1111111111111111111111111111111111111111';
const B = '0x2222222222222222222222222222222222222222';

for (const [label, change, error] of [
  ['RPC identity', s => { s.chainId = 1; }, /RPC chain identity mismatch/],
  ['threshold', s => { s.threshold = 4; }, /not exact 3-of-5/],
  ['reported count', s => { s.count = 8; }, /not exact 3-of-5/],
  ['returned count', s => { s.live.push(B); }, /not exact 3-of-5/],
  ['validator identity', s => { s.live[0] = B; }, /does not match configured signers/],
]) {
  test(`live topology rejects isolated ${label} drift`, async () => {
    const { ethers } = await import('ethers');
    const expected = Array.from({ length: 5 }, (_, i) => '0x' + String(i + 1).padStart(40, '0'));
    const state = { chainId: 9005, threshold: 3, count: 5, live: [...expected] };
    const iface = new ethers.Interface([
      'function signaturesRequired() view returns(uint256)',
      'function getValidatorCount() view returns(uint256)',
      'function getValidators() view returns(address[])',
    ]);
    const provider = {
      getNetwork: async () => ({ chainId: state.chainId }), resolveName: async n => n,
      call: async ({ data }) => {
        const name = iface.parseTransaction({ data }).name;
        return iface.encodeFunctionResult(name, [{ signaturesRequired: state.threshold, getValidatorCount: state.count, getValidators: state.live }[name]]);
      },
    };
    const run = () => verifyLiveValidatorTopology([{ name: 'LITHO', chainId: 9005, rpc: 'https://rpc.example', bridge: A }], expected, () => provider);
    await run(); change(state); await assert.rejects(run, error);
  });
}

test('accepts a unique signer set at or above threshold', () => {
  const result = validateValidatorSet([{ address: A }, { address: B }], 2);
  assert.equal(result.required, 2);
  assert.deepEqual(result.addresses, [A, B]);
});

test('rejects duplicate signer identities and a threshold above the unique set', () => {
  assert.throws(
    () => validateValidatorSet([{ address: A }, { address: A }], 2),
    /must be unique/,
  );
  assert.throws(
    () => validateValidatorSet([{ address: A }], 2),
    /below configured threshold/,
  );
  assert.throws(
    () => validateValidatorSet([{ address: '0x0000000000000000000000000000000000000000' }], 1),
    /invalid address/,
  );
});

test('rejects malformed, zero, negative, and unsafe operational integers', () => {
  for (const value of ['', '0', '-1', '1.5', 'abc', '9007199254740992']) {
    assert.throws(() => positiveSafeInteger(value, 'value'));
  }
  assert.equal(positiveSafeInteger('8000', 'value'), 8000);
});

const productionEnv = () => Object.fromEntries([
  ['SIGNATURES_REQUIRED', '3'],
  ...Array.from({ length: 5 }, (_, index) => [
    [`VALIDATOR_SIGNER_URL_${index}`, `https://signer-${index}.internal`],
    [`VALIDATOR_SIGNER_ADDRESS_${index}`, `0x${String(index + 1).padStart(40, '0')}`],
    [`VALIDATOR_SIGNER_CA_FILE_${index}`, `/run/secrets/signer-${index}-ca.crt`],
    [`VALIDATOR_SIGNER_CERT_FILE_${index}`, `/run/secrets/signer-${index}-client.crt`],
    [`VALIDATOR_SIGNER_KEY_FILE_${index}`, `/run/secrets/signer-${index}-client.key`],
  ]).flat(),
]);

test('production signer environment is exactly contiguous 3-of-5', () => {
  assert.equal(validateProductionSignerEnvironment(productionEnv()).length, 5);
  const gap = productionEnv(); delete gap.VALIDATOR_SIGNER_URL_3;
  assert.throws(() => validateProductionSignerEnvironment(gap), /signer 3/);
  const extra = productionEnv(); extra.VALIDATOR_SIGNER_URL_7 = 'https://extra.internal';
  assert.throws(() => validateProductionSignerEnvironment(extra), /exactly signer indices/);
  const extraCredential = productionEnv(); extraCredential.VALIDATOR_SIGNER_KEY_FILE_7 = '/run/secrets/extra.key';
  assert.throws(() => validateProductionSignerEnvironment(extraCredential), /exactly signer indices/);
  const wrongThreshold = productionEnv(); wrongThreshold.SIGNATURES_REQUIRED = '4';
  assert.throws(() => validateProductionSignerEnvironment(wrongThreshold), /exactly 3/);
  const bearer = productionEnv(); bearer.VALIDATOR_SIGNER_TOKEN_FILE_0 = '/run/secrets/token';
  assert.throws(() => validateProductionSignerEnvironment(bearer), /must use mTLS/);
  const missingCert = productionEnv(); delete missingCert.VALIDATOR_SIGNER_CERT_FILE_2;
  assert.throws(() => validateProductionSignerEnvironment(missingCert), /mTLS cert_file is required/);
  const aws = productionEnv(); aws.AWS_REGION = 'us-east-1';
  assert.throws(() => validateProductionSignerEnvironment(aws), /not supported/);
});

test('candidate rejects legacy thresholds and every noncanonical signer index', () => {
  for (const threshold of ['2','4','5','03','3.0']) {
    const env = productionEnv(); env.SIGNATURES_REQUIRED = threshold;
    assert.throws(() => validateProductionSignerEnvironment(env), /exactly 3/);
  }
  for (const index of ['5','6','9','10','100','-1','01']) {
    for (const field of ['URL','ADDRESS','CA_FILE','CERT_FILE','KEY_FILE','TOKEN_FILE']) {
      const env = productionEnv(); env[`VALIDATOR_SIGNER_${field}_${index}`] = 'unexpected';
      assert.throws(() => validateProductionSignerEnvironment(env), /exactly signer indices/);
    }
  }
});

test('startup topology must match the exact live on-chain 3-of-5 set', async () => {
  const expected = Array.from({ length: 5 }, (_, i) => `0x${String(i + 1).padStart(40, '0')}`);
  const provider = {
    getNetwork: async () => ({ chainId: 9005 }),
    call: async ({ data }) => {
      const iface = new (await import('ethers')).ethers.Interface([
        'function signaturesRequired() view returns (uint256)',
        'function getValidatorCount() view returns (uint256)',
        'function getValidators() view returns (address[])',
      ]);
      const selector = data.slice(0, 10);
      if (selector === iface.getFunction('signaturesRequired').selector) return iface.encodeFunctionResult('signaturesRequired', [3]);
      if (selector === iface.getFunction('getValidatorCount').selector) return iface.encodeFunctionResult('getValidatorCount', [5]);
      return iface.encodeFunctionResult('getValidators', [expected]);
    },
    resolveName: async (name) => name,
  };
  await verifyLiveValidatorTopology(
    [{ name: 'LITHO', chainId: 9005, rpc: 'https://rpc.example', bridge: A }],
    expected.map((item) => item.toLowerCase()),
    () => provider,
  );
});
