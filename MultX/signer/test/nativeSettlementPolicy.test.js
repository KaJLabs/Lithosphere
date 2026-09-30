import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Wallet, verifyMessage, getBytes, AbiCoder, keccak256 } from 'ethers';
import { createNativeStateJournal } from '../src/nativeStateJournal.js';
import {
  cancelDigest,
  createNativeSettlementDecision,
  nativeDecisionKey,
  releaseDigest,
  settlementIdentity,
} from '../src/nativeSettlementPolicy.js';

const coder = AbiCoder.defaultAbiCoder();
const address = n => `0x${n.toString(16).padStart(40, '0')}`;
const hash = n => `0x${n.toString(16).padStart(64, '0')}`;
const authorityEpoch = hash(99);
const identity = {
  sourceChain: 1, sourceVault: address(1), sourceDepositor: address(2), sourceNonce: 0,
  clientReference: hash(3), sourceTxHash: hash(4), sourceQuoteExpiry: 2000, releaseDeadline: 2000,
};
identity.operationId = keccak256(coder.encode(
  ['uint256', 'address', 'address', 'uint256', 'bytes32'],
  [identity.sourceChain, identity.sourceVault, identity.sourceDepositor, identity.sourceNonce, identity.clientReference],
));
const release = { ...identity, sourceAmount: 10, recipient: address(5), outputAmount: 9, authorizationExpiry: 1900 };
const cancel = { ...identity, authorizationExpiry: 2300 };
const deposit = { depositor: address(2), recipient: address(5), amount: 10, targetChain: 56,
  quotedOutput: 9, quoteExpiry: 2000, targetVault: address(6), finalityDelaySeconds: 100 };
const refund = { operationId: identity.operationId, cancellationTxHash: hash(7), cancellationBlockHash: hash(8),
  cancellationBlockNumber: 100, authorizationExpiry: 2500 };
const destination = { chainId: 56, vault: address(6), authorityEpoch };
const source = { chainId: 1, vault: address(1) };
const cancellation = { txHash: hash(7), blockHash: hash(8), blockNumber: 100, finalized: true };

function fixture(time, existing) {
  const directory = existing?.directory || fs.mkdtempSync(path.join(os.tmpdir(), 'multx-native-policy-'));
  const file = path.join(directory, 'state.jsonl');
  let currentTime = time;
  const signer = existing?.signer || Wallet.createRandom();
  const journal = createNativeStateJournal(file);
  return { directory, file, signer, journal, setTime: value => { currentTime = value; },
    policy: createNativeSettlementDecision({ journal, signer, now: () => currentTime }) };
}

test('canonical identity prevents depositor/client-reference squatting', () => {
  assert.equal(settlementIdentity(identity).operationId, identity.operationId);
  assert.throws(() => settlementIdentity({ ...identity, sourceDepositor: address(9) }), /canonical source identity/);
  assert.throws(() => settlementIdentity({ ...identity, releaseDeadline: 1999 }), /must equal source quote expiry/);
  assert.equal(nativeDecisionKey(identity.operationId), `native:${identity.operationId}`);
});

test('the same intact signer journal recovers an expired unused release', async () => {
  const f = fixture(1800);
  try {
    const releaseSignature = await f.policy.signRelease(release, destination, async () => {});
    assert.equal(verifyMessage(getBytes(releaseDigest(release, 56, address(6))), releaseSignature), f.signer.address);
    f.setTime(2201);
    const cancellationSignature = await f.policy.signCancellation(cancel, release, destination, async () => {});
    assert.equal(verifyMessage(getBytes(cancelDigest(cancel, 56, address(6))), cancellationSignature), f.signer.address);
    assert.equal(f.journal.get(nativeDecisionKey(identity.operationId)).state, 'CANCELLATION_AUTHORIZED');
  } finally { fs.rmSync(f.directory, { recursive: true, force: true }); }
});

test('three release-committed signers retain a three-signer cancellation quorum after expiry and restart', async () => {
  const fixtures = [fixture(1800), fixture(1800), fixture(1800)];
  try {
    await Promise.all(fixtures.map(item => item.policy.signRelease(release, destination, async () => {})));
    const restored = fixtures.map(item => fixture(2201, item));
    const signatures = await Promise.all(restored.map(item =>
      item.policy.signCancellation(cancel, release, destination, async () => {})));
    assert.equal(signatures.length, 3);
    assert(restored.every(item => item.journal.get(nativeDecisionKey(identity.operationId)).state === 'CANCELLATION_AUTHORIZED'));
  } finally { fixtures.forEach(item => fs.rmSync(item.directory, { recursive: true, force: true })); }
});

test('a failed post-journal evidence check remains recoverable after expiry and restart', async () => {
  const fixtures = [fixture(1800), fixture(1800), fixture(1800)];
  try {
    await Promise.all(fixtures.map(async item => {
      let checks = 0;
      await assert.rejects(item.policy.signRelease(release, destination, async () => {
        checks += 1; if (checks === 2) throw new Error('source reorg');
      }), /source reorg/);
    }));
    const restored = fixtures.map(item => fixture(2201, item));
    const signatures = await Promise.all(restored.map(item =>
      item.policy.signCancellation(cancel, release, destination, async () => {})));
    assert.equal(signatures.length, 3);
  } finally { fixtures.forEach(item => fs.rmSync(item.directory, { recursive: true, force: true })); }
});

test('does not cancel while a recorded release authorization can still execute', async () => {
  const f = fixture(1800);
  try {
    await f.policy.signRelease(release, destination, async () => {});
    f.setTime(1850);
    await assert.rejects(f.policy.signCancellation({ ...cancel, releaseDeadline: 1800, sourceQuoteExpiry: 1800 },
      { ...release, releaseDeadline: 1800, sourceQuoteExpiry: 1800 }, destination, async () => {}),
    /recorded release authorization remains executable/);
  } finally { fs.rmSync(f.directory, { recursive: true, force: true }); }
});

test('cancel then refund is allowed, while finalized payout blocks recovery', async () => {
  const recovery = fixture(2201);
  const paid = fixture(1800);
  try {
    await recovery.policy.signCancellation(cancel, release, destination, async () => {});
    await recovery.policy.signRefund({ request: refund, deposit, identity, source, destination, cancellation }, async () => {});
    assert.equal(recovery.journal.get(nativeDecisionKey(identity.operationId)).state, 'REFUND_AUTHORIZED');

    await paid.policy.signRelease(release, destination, async () => {});
    await paid.policy.signFinalization({ operation: release, destinationTxHash: hash(10), source, destination }, async () => {});
    paid.setTime(2201);
    await assert.rejects(paid.policy.signCancellation(cancel, release, destination, async () => {}), /terminal/);
    await assert.rejects(paid.policy.signRefund({ request: refund, deposit, identity, source, destination, cancellation }, async () => {}), /payout already finalized/);
  } finally {
    fs.rmSync(recovery.directory, { recursive: true, force: true });
    fs.rmSync(paid.directory, { recursive: true, force: true });
  }
});

test('a cancellation authorization can yield to a canonical late-confirmed payout', async () => {
  const f = fixture(2201);
  try {
    await f.policy.signCancellation(cancel, release, destination, async () => {});
    const signature = await f.policy.signFinalization({
      operation: release, destinationTxHash: hash(10), source, destination,
    }, async () => {});
    assert.match(signature, /^0x[0-9a-f]{130}$/i);
    assert.equal(f.journal.get(nativeDecisionKey(identity.operationId)).state, 'PAYOUT_FINALIZED');
    await assert.rejects(f.policy.signRefund({
      request: refund, deposit, identity, source, destination, cancellation,
    }, async () => {}), /payout already finalized/);
  } finally { fs.rmSync(f.directory, { recursive: true, force: true }); }
});

test('rejects cancellation evidence failure, insufficient finality and immutable value drift', async () => {
  const f = fixture(2201);
  try {
    await assert.rejects(f.policy.signCancellation(cancel, release, destination, async () => { throw new Error('destination not None'); }), /destination not None/);
    await assert.rejects(f.policy.signRefund({ request: refund, deposit, identity, source, destination,
      cancellation: { ...cancellation, finalized: false } }, async () => {}), /evidence mismatch/);
    await f.policy.signCancellation(cancel, release, destination, async () => {});
    await assert.rejects(f.policy.signRefund({ request: refund, deposit: { ...deposit, quotedOutput: 8 }, identity,
      source, destination, cancellation }, async () => {}), /operation\/epoch drift/);
  } finally { fs.rmSync(f.directory, { recursive: true, force: true }); }
});
