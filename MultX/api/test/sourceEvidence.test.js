import test from 'node:test';
import assert from 'node:assert/strict';
import { verifySourceEvidence } from '../src/services/sourceEvidence.js';
const address = n => `0x${String(n).repeat(40)}`;
const hash = `0x${'ab'.repeat(32)}`;
const source = { chainId: 9005, bridgeAddress: address(1), confirmations: 12 };
const lock = { sourceChain: 9005, sourceBridge: address(1), sourceBlock: 100, sourceBlockHash: hash,
  sourceTxHash: `0x${'cd'.repeat(32)}`, sourceToken: address(2), user: address(3), amount: '10', targetChain: 1, sourceNonce: '7' };
function fixture() {
  const event = { address: source.bridgeAddress, blockNumber: 100, blockHash: hash, removed: false,
    args: { txHash: lock.sourceTxHash, token: lock.sourceToken, user: lock.user, amount: 10n, targetChain: 1n, nonce: 7n } };
  return { event, provider: { getNetwork: async () => ({ chainId: 9005n }), getBlockNumber: async () => 111,
    getBlock: async () => ({ hash }) }, contract: { filters: { TokensLocked: () => ({}) }, queryFilter: async () => [event] } };
}
test('current exact source evidence with required confirmations is accepted', async () => {
  await verifySourceEvidence(source, lock, fixture());
});
for (const kind of ['missing', 'removed', 'wrong amount', 'wrong block', 'duplicate']) {
  test(`refuses ${kind} source event`, async () => {
    const f = fixture();
    if (kind === 'missing') f.contract.queryFilter = async () => [];
    if (kind === 'duplicate') f.contract.queryFilter = async () => [f.event, f.event];
    if (kind === 'removed') f.event.removed = true;
    if (kind === 'wrong amount') f.event.args.amount = 11n;
    if (kind === 'wrong block') f.event.blockNumber = 101;
    await assert.rejects(verifySourceEvidence(source, lock, f), /Source lock event/);
  });
}
test('refuses source reorg during event query', async () => {
  const f = fixture();
  f.contract.queryFilter = async () => { f.provider.getBlock = async () => ({ hash: `0x${'ff'.repeat(32)}` }); return [f.event]; };
  await assert.rejects(verifySourceEvidence(source, lock, f), /no longer canonical/);
});
test('refuses missing hash, missing policy, wrong network and insufficient finality', async () => {
  await assert.rejects(verifySourceEvidence(source, { ...lock, sourceBlockHash: null }, fixture()), /hash is required/);
  await assert.rejects(verifySourceEvidence({ ...source, confirmations: undefined }, lock, fixture()), /explicit positive/);
  const f = fixture(); f.provider.getNetwork = async () => ({ chainId: 56n });
  await assert.rejects(verifySourceEvidence(source, lock, f), /chain ID mismatch/);
  const g = fixture(); g.provider.getBlockNumber = async () => 110;
  await assert.rejects(verifySourceEvidence(source, lock, g), /insufficient confirmations/);
});
