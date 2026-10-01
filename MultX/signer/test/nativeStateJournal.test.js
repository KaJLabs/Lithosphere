import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createNativeStateJournal } from '../src/nativeStateJournal.js';

const key = `native:0x${'11'.repeat(32)}`;
const operationHash = `0x${'22'.repeat(32)}`;
const authorityEpoch = `0x${'33'.repeat(32)}`;
const decisionHash = n => `0x${String(n).repeat(64)}`;

function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'multx-native-journal-'));
  return { directory, file: path.join(directory, 'state.jsonl') };
}

test('persists release to cancellation recovery across restart', () => {
  const { directory, file } = fixture();
  try {
    let journal = createNativeStateJournal(file);
    journal.transition({ key, state: 'RELEASE_AUTHORIZED', operationHash, decisionHash: decisionHash(4), authorityEpoch, authorizationExpiry: 100 });
    journal = createNativeStateJournal(file);
    journal.transition({ key, state: 'CANCELLATION_AUTHORIZED', operationHash, decisionHash: decisionHash(5), authorityEpoch, authorizationExpiry: 200 });
    journal = createNativeStateJournal(file);
    assert.equal(journal.get(key).state, 'CANCELLATION_AUTHORIZED');
    journal.transition({ key, state: 'REFUND_AUTHORIZED', operationHash, decisionHash: decisionHash(6), authorityEpoch, authorizationExpiry: 300 });
    assert.equal(journal.get(key).sequence, 3);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('terminal payout refuses cancellation and operation/epoch drift', () => {
  const { directory, file } = fixture();
  try {
    const journal = createNativeStateJournal(file);
    journal.transition({ key, state: 'RELEASE_AUTHORIZED', operationHash, decisionHash: decisionHash(4), authorityEpoch, authorizationExpiry: 100 });
    journal.transition({ key, state: 'PAYOUT_PROOF_PENDING', operationHash, decisionHash: decisionHash(5), authorityEpoch });
    journal.transition({ key, state: 'PAYOUT_FINALIZED', operationHash, decisionHash: decisionHash(5), authorityEpoch });
    assert.throws(() => journal.transition({ key, state: 'CANCELLATION_AUTHORIZED', operationHash,
      decisionHash: decisionHash(6), authorityEpoch, authorizationExpiry: 200 }), /refusing native transition/);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('reload rejects a forged early certificate renewal', () => {
  const { directory, file } = fixture();
  try {
    const journal = createNativeStateJournal(file);
    journal.transition({ key, state: 'CANCELLATION_AUTHORIZED', operationHash,
      decisionHash: decisionHash(4), authorityEpoch, authorizationExpiry: 200 });
    fs.appendFileSync(file, `${JSON.stringify({ key, sequence: 2, state: 'CANCELLATION_AUTHORIZED',
      operationHash, decisionHash: decisionHash(5), authorityEpoch,
      authorizationExpiry: 300, renewedAt: 199 })}\n`);
    assert.throws(() => createNativeStateJournal(file), /invalid native certificate renewal/);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('fails closed on invalid history after restart', () => {
  const { directory, file } = fixture();
  try {
    fs.writeFileSync(file, `${JSON.stringify({ key, sequence: 1, state: 'REFUND_AUTHORIZED', operationHash,
      decisionHash: decisionHash(6), authorityEpoch, authorizationExpiry: 1 })}\n${JSON.stringify({ key, sequence: 2,
      state: 'RELEASE_AUTHORIZED', operationHash, decisionHash: decisionHash(4), authorityEpoch,
      authorizationExpiry: 100 })}\n`);
    assert.throws(() => createNativeStateJournal(file), /invalid native settlement transition/);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
