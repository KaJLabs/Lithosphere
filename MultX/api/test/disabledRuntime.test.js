import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { resolveMultxEnabled } from '../src/config.js';

test('production runtime fails closed when MULTX_ENABLED is absent', () => {
  assert.equal(resolveMultxEnabled('production', undefined), false);
  assert.equal(resolveMultxEnabled('production', ''), false);
  assert.equal(resolveMultxEnabled('production', 'false'), false);
});

test('production runtime requires an exact activation value', () => {
  assert.equal(resolveMultxEnabled('production', 'true'), true);
  assert.throws(
    () => resolveMultxEnabled('production', 'TRUE'),
    /MULTX_ENABLED must be exactly true or false/,
  );
  assert.throws(
    () => resolveMultxEnabled('production', '1'),
    /MULTX_ENABLED must be exactly true or false/,
  );
});

test('non-production runtime preserves development behavior unless explicitly disabled', () => {
  assert.equal(resolveMultxEnabled('test', undefined), true);
  assert.equal(resolveMultxEnabled('development', 'true'), true);
  assert.equal(resolveMultxEnabled('development', 'false'), false);
});

test('disabled production config starts without a deployment manifest', () => {
  const output = execFileSync(
    process.execPath,
    ['--input-type=module', '-e', "import('./src/config.js').then(({config}) => process.stdout.write(String(config.multxEnabled)))"],
    {
      cwd: new URL('..', import.meta.url),
      env: {
        ...process.env,
        NODE_ENV: 'production',
        MULTX_ENABLED: 'false',
        MULTX_NETWORK_CONFIG_FILE: '',
      },
      encoding: 'utf8',
    },
  );
  assert.equal(output, 'false');
});
