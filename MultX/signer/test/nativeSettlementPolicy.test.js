import test from 'node:test';
import assert from 'node:assert/strict';
import { Wallet, verifyMessage, getBytes, AbiCoder, keccak256 } from 'ethers';
import {
  createNativeSettlementDecision,
  nativeDecisionKey,
  releaseDigest,
  settlementIdentity,
} from '../src/nativeSettlementPolicy.js';

const coder = AbiCoder.defaultAbiCoder();
const address = n => `0x${n.toString(16).padStart(40, '0')}`;
const hash = n => `0x${n.toString(16).padStart(64, '0')}`;
const identity = {
  sourceChain: 1,
  sourceVault: address(1),
  sourceDepositor: address(2),
  sourceNonce: 0,
  clientReference: hash(3),
  sourceTxHash: hash(4),
  sourceQuoteExpiry: 2000,
  releaseDeadline: 2000,
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
const destination = { chainId: 56, vault: address(6) };
const source = { chainId: 1, vault: address(1), finalityDelaySeconds: 100 };
const cancellation = { txHash: hash(7), blockHash: hash(8), blockNumber: 100, finalized: true };

function fixture(time) {
  let currentTime = time;
  const decisions = new Map();
  const journal = { record(key, value) {
    const prior = decisions.get(key);
    if (prior && prior !== value) throw new Error(`refusing equivocation for ${key}`);
    if (prior) return false;
    decisions.set(key, value); return true;
  } };
  const signer = Wallet.createRandom();
  return { signer, decisions, setTime: value => { currentTime = value; },
    policy: createNativeSettlementDecision({ journal, signer, now: () => currentTime }) };
}

test('canonical identity prevents depositor/client-reference squatting', () => {
  assert.equal(settlementIdentity(identity).operationId, identity.operationId);
  assert.throws(() => settlementIdentity({ ...identity, sourceDepositor: address(9) }), /canonical source identity/);
  assert.equal(nativeDecisionKey(identity.operationId), `native:${identity.operationId}`);
});

test('release path is durable and rejects a later cancellation/refund path', async () => {
  const { policy, signer, setTime } = fixture(1800);
  const signature = await policy.signRelease(release, destination, async () => {});
  assert.equal(verifyMessage(getBytes(releaseDigest(release, 56, address(6))), signature), signer.address);
  setTime(2201);
  await assert.rejects(policy.signCancellation(cancel, destination, async () => {}), /refusing equivocation/);
});

test('cancel then refund share one durable terminal-path decision', async () => {
  const { policy, decisions } = fixture(2201);
  await policy.signCancellation(cancel, destination, async () => {});
  await policy.signRefund({ request: refund, deposit, identity, source, cancellation }, async () => {});
  assert.equal(decisions.size, 1);
});

test('rejects release before evidence, cancellation before deadline and refund without finality', async () => {
  const early = fixture(1900);
  await assert.rejects(early.policy.signRelease(release, destination, async () => { throw new Error('source missing'); }), /source missing/);
  await assert.rejects(early.policy.signCancellation(cancel, destination, async () => {}), /release window remains active/);
  const late = fixture(2050);
  await assert.rejects(late.policy.signRefund({ request: refund, deposit, identity, source, cancellation }, async () => {}), /not final/);
  const final = fixture(2201);
  await assert.rejects(final.policy.signRefund({ request: refund, deposit, identity, source,
    cancellation: { ...cancellation, finalized: false } }, async () => {}), /evidence mismatch/);
});

test('rejects a destination release window beyond the source quote', async () => {
  const { policy } = fixture(1800);
  await assert.rejects(policy.signRelease({ ...release, sourceQuoteExpiry: 1999 }, destination, async () => {}),
    /release exceeds source quote/);
});

test('rechecks evidence after persisting and withholds signature on a reorg', async () => {
  const { policy, decisions } = fixture(1800);
  let checks = 0;
  await assert.rejects(policy.signRelease(release, destination, async () => {
    checks += 1;
    if (checks === 2) throw new Error('source reorg');
  }), /source reorg/);
  assert.equal(decisions.size, 1);
});
