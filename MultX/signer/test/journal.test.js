import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { createDecisionJournal } from '../src/journal.js';

const key = '9005:0x1111111111111111111111111111111111111111:7';

test('persists a signing decision before reuse and rejects equivocation after restart', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'multx-journal-'));
  const stateFile = path.join(directory, 'decisions.jsonl');
  try {
    const first = createDecisionJournal(stateFile);
    const firstHash = `0x${'aa'.repeat(32)}`;
    const conflictingHash = `0x${'bb'.repeat(32)}`;
    assert.equal(first.record(key, firstHash), true);
    assert.equal(first.record(key, firstHash), false);

    const restored = createDecisionJournal(stateFile);
    assert.equal(restored.record(key, firstHash), false);
    assert.throws(() => restored.record(key, conflictingHash), /refusing equivocation/);
    assert.equal(fs.readFileSync(stateFile, 'utf8').trim().split('\n').length, 1);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('fails closed on a corrupt journal', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'multx-journal-'));
  const stateFile = path.join(directory, 'decisions.jsonl');
  try {
    fs.writeFileSync(stateFile, '{not-json}\n', { mode: 0o600 });
    assert.throws(() => createDecisionJournal(stateFile), /invalid JSON/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('rejects malformed journal decisions', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'multx-journal-'));
  const stateFile = path.join(directory, 'decisions.jsonl');
  try {
    const journal = createDecisionJournal(stateFile);
    assert.throws(() => journal.record('9005:0', `0x${'aa'.repeat(32)}`), /invalid signing journal/);
    assert.throws(() => journal.record(key, 'not-a-hash'), /invalid signing journal/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('persists native operation terminal-path decisions', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'multx-journal-'));
  const stateFile = path.join(directory, 'decisions.jsonl');
  try {
    const journal = createDecisionJournal(stateFile);
    const operationKey = `native:0x${'11'.repeat(32)}`;
    assert.equal(journal.record(operationKey, `0x${'aa'.repeat(32)}`), true);
    assert.throws(() => journal.record(operationKey, `0x${'bb'.repeat(32)}`), /refusing equivocation/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('strict mode rejects permissive journal storage', () => {
  if (process.platform === 'win32') return;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'multx-journal-'));
  const stateFile = path.join(directory, 'decisions.jsonl');
  try {
    fs.chmodSync(directory, 0o755);
    assert.throws(
      () => createDecisionJournal(stateFile, { strictPermissions: true }),
      /owner-only permissions/,
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
