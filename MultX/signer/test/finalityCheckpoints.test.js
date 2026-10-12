import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initializeFinalityCheckpoints, createFinalityCheckpoints } from '../src/finalityCheckpoints.js';

test('checkpoint initialization is explicit, exclusive and bound to the approved identity', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'multx-checkpoint-'));
  try {
    const file = path.join(dir, 'checkpoints');
    assert.throws(() => createFinalityCheckpoints(file, 'a'.repeat(64)));
    assert.equal(fs.existsSync(file), false);
    initializeFinalityCheckpoints(file, 'a'.repeat(64));
    assert.throws(() => initializeFinalityCheckpoints(file, 'a'.repeat(64)), /EEXIST/);
    assert.throws(() => createFinalityCheckpoints(file, 'b'.repeat(64)), /integrity mismatch/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('checkpoint storage rejects permissions and symlinks on Linux', { skip: process.platform === 'win32' }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'multx-checkpoint-mode-'));
  try {
    const file = path.join(dir, 'checkpoints');
    initializeFinalityCheckpoints(file, 'a'.repeat(64));
    fs.chmodSync(file, 0o644);
    assert.throws(() => createFinalityCheckpoints(file, 'a'.repeat(64)), /owner-only/);
    fs.chmodSync(file, 0o600);
    const alias = path.join(dir, 'alias');
    fs.symlinkSync(file, alias);
    assert.throws(() => createFinalityCheckpoints(alias, 'a'.repeat(64)), /owner-only/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
