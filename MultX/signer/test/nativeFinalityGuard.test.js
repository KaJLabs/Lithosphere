import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createNativeFinalityGuard } from '../src/nativeFinalityGuard.js';
const methods = ['verifyRelease', 'verifyCancellation', 'verifyFinalization', 'verifyRefund'];
for (const method of methods) {
  test(`${method}: evidence anomaly blocks every signing direction after restart`, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'multx-hold-'));
    try {
      const file = path.join(dir, 'journal.finality-hold');
      const verifier = Object.fromEntries(methods.map(name => [name, async () => 'verified']));
      let guard = createNativeFinalityGuard(verifier, file);
      assert.equal(await guard.verifier[method](), 'verified');
      verifier[method] = async () => { throw new Error('private RPC credential'); };
      await assert.rejects(guard.verifier[method](), /HOLD/);
      assert.equal(fs.readFileSync(file, 'utf8').includes('credential'), false);
      guard = createNativeFinalityGuard(verifier, file);
      assert.throws(guard.assertClear, /HOLD/);
      for (const name of methods) await assert.rejects(guard.verifier[name](), /HOLD/);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
}
test('another in-flight check cannot succeed after a hold', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'multx-hold-race-'));
  try {
    let resume;
    const guard = createNativeFinalityGuard({
      verifyRelease: () => new Promise(resolve => { resume = resolve; }),
      verifyRefund: async () => { throw new Error('disagreement'); },
    }, path.join(dir, 'hold'));
    const pending = guard.verifier.verifyRelease();
    await assert.rejects(guard.verifier.verifyRefund(), /HOLD/);
    resume(); await assert.rejects(pending, /HOLD/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('guarded signing returns its signature when no hold occurs', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'multx-sign-clear-'));
  try {
    const guard = createNativeFinalityGuard({}, path.join(dir, 'hold'));
    assert.equal(await guard.signMessage({ signMessage: async message => `signed:${message}` }, 'message'), 'signed:message');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('M01: a signature finishing after another request sets HOLD is never returned', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'multx-sign-race-'));
  try {
    const file = path.join(dir, 'hold');
    const guard = createNativeFinalityGuard({ verifyRelease: async () => {
      throw new Error('provider inconsistency');
    } }, file);
    let complete;
    const pending = guard.signMessage({ signMessage: () => new Promise(resolve => { complete = resolve; }) }, 'message');
    const rejected = assert.rejects(pending, /HOLD/);
    await assert.rejects(guard.verifier.verifyRelease(), /HOLD/);
    complete('signature-must-not-escape');
    await rejected;
    const restarted = createNativeFinalityGuard({}, file);
    await assert.rejects(restarted.signMessage({ signMessage: async () => {
      assert.fail('held signer must not be invoked');
    } }, 'message'), /HOLD/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
