import assert from 'node:assert/strict';
import test from 'node:test';
import { loadNativeSignerPolicy, loadSignerPolicy } from '../src/runtimeConfig.js';

test('disabled signer can start without a bridge policy', () => {
  assert.equal(loadSignerPolicy({ signingEnabled: false }), null);
});

test('enabled signer fails closed without a bridge policy', () => {
  assert.throws(
    () => loadSignerPolicy({ signingEnabled: true }),
    /required when signing is enabled/,
  );
});

test('policy sources remain mutually exclusive while disabled', () => {
  assert.throws(
    () => loadSignerPolicy({
      signingEnabled: false,
      policyFile: 'policy.json',
      policyJson: '{}',
    }),
    /never both/,
  );
});

test('production rejects policy JSON from the environment', () => {
  assert.throws(
    () => loadSignerPolicy({
      signingEnabled: true,
      production: true,
      policyJson: '{"sources":[]}',
    }),
    /must be mounted through SIGNER_POLICY_FILE/,
  );
});

test('native policy is optional only while native signing is disabled', () => {
  assert.equal(loadNativeSignerPolicy({ signingEnabled: false }), null);
  assert.throws(() => loadNativeSignerPolicy({ signingEnabled: true }), /required when native signing is enabled/);
});

test('production rejects native policy JSON from the environment', () => {
  assert.throws(() => loadNativeSignerPolicy({
    signingEnabled: true, production: true, policyJson: '{"chains":[]}',
  }), /must be mounted through SIGNER_NATIVE_POLICY_FILE/);
});
