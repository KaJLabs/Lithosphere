import assert from 'node:assert/strict';
import test from 'node:test';
import { validateDeploymentMode } from '../src/deploymentMode.js';

test('native canary production startup rejects the depth-only release path', () => {
  assert.throws(() => validateDeploymentMode({ NODE_ENV: 'production',
    SIGNER_RELEASE_SIGNING_ENABLED: 'true' }), /excludes legacy release signing/);
});

test('production accepts only direct mTLS with a file journal', () => {
  assert.deepEqual(validateDeploymentMode({ NODE_ENV: 'production' }), {
    journalBackend: 'file',
    production: true,
    transport: 'mtls',
  });
  assert.throws(
    () => validateDeploymentMode({ NODE_ENV: 'production', SIGNER_TRANSPORT: 'proxy-http' }),
    /requires direct mTLS/,
  );
  assert.throws(
    () => validateDeploymentMode({ NODE_ENV: 'production', SIGNER_JOURNAL_BACKEND: 'dynamodb' }),
    /only SIGNER_JOURNAL_BACKEND=file/,
  );
});

test('production rejects legacy AWS and bearer-proxy settings', () => {
  for (const [name, value] of [
    ['AWS_REGION', 'us-east-1'],
    ['SIGNER_KMS_KEY_ARN', 'arn:rejected'],
    ['SIGNER_DYNAMODB_TABLE', 'rejected'],
    ['SIGNER_BEARER_TOKEN', 'rejected'],
    ['SIGNER_BEARER_TOKEN_FILE', '/run/secrets/rejected'],
    ['SIGNER_BEHIND_TLS_PROXY', 'true'],
  ]) {
    assert.throws(
      () => validateDeploymentMode({ NODE_ENV: 'production', [name]: value }),
      new RegExp(`${name} is forbidden`),
    );
  }
});
