import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const api = fileURLToPath(new URL('../', import.meta.url));
const manifestPath = path.join(api, 'review/runtime-source-manifest.json');
const verifier = path.join(api, 'review/verify-runtime-source.mjs');

test('API runtime manifest accepts exact image source and rejects a changed lockfile', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'multx-source-manifest-'));
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    assert.equal(manifest.files.length, 86);
    for (const file of manifest.files) {
      const target = path.join(root, file.path);
      mkdirSync(path.dirname(target), { recursive: true });
      copyFileSync(path.join(api, file.path), target);
    }
    const env = { ...process.env, MULTX_SOURCE_ROOT: root, MULTX_SOURCE_MANIFEST: manifestPath };
    const check = () => spawnSync(process.execPath, [verifier], { env, encoding: 'utf8' });
    const good = check();
    assert.equal(good.status, 0, good.stdout + good.stderr);
    assert.match(good.stdout, /result=PASS/);
    appendFileSync(path.join(root, 'package-lock.json'), '\n');
    const bad = check();
    assert.equal(bad.status, 1, bad.stdout + bad.stderr);
    assert.match(bad.stdout, /mismatched=package-lock\.json/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
