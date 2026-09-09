import test from 'node:test';
import assert from 'node:assert/strict';
import { Wallet, verifyMessage, getBytes } from 'ethers';
import { createReleaseDecision } from '../src/signingDecision.js';
import { releaseMessageHash } from '../src/policy.js';

test('queued signing rechecks source after waiting and never journals an orphan', async () => {
  const addr = n => `0x${String(n).repeat(40)}`, hash = `0x${'ab'.repeat(32)}`;
  const source = { chainId: 9005, bridgeAddress: addr(1), confirmations: 12 };
  const lock = { sourceChain: 9005, sourceBridge: addr(1), sourceBlock: 100, sourceBlockHash: hash,
    sourceTxHash: `0x${'cd'.repeat(32)}`, sourceToken: addr(2), user: addr(3), amount: '10', targetChain: 1,
    sourceNonce: '7', releaseToken: addr(4), releaseBridge: addr(5) };
  let exists = true, releaseJournal, enteredJournal;
  const entered = new Promise(resolve => { enteredJournal = resolve; });
  const hold = new Promise(resolve => { releaseJournal = resolve; });
  const decisions = [], signer = Wallet.createRandom();
  const decide = createReleaseDecision({ signer, journal: { record: async (key, digest) => {
    decisions.push({ key, digest }); enteredJournal(); await hold;
  } } });
  const client = { provider: { getNetwork: async () => ({ chainId: 9005n }), getBlockNumber: async () => 111,
    getBlock: async () => ({ hash }) }, contract: { filters: { TokensLocked: () => ({}) }, queryFilter: async () => exists ? [{
      address: addr(1), blockNumber: 100, blockHash: hash, args: { txHash: lock.sourceTxHash, token: addr(2), user: addr(3), amount: 10n, targetChain: 1n, nonce: 7n },
    }] : [] } };
  const first = decide(source, lock, client);
  const firstRefused = assert.rejects(first, /missing or ambiguous/);
  await entered;
  const second = decide(source, lock, client);
  const refused = assert.rejects(second, /missing or ambiguous/);
  exists = false; releaseJournal();
  await firstRefused;
  await refused;
  assert.equal(decisions.length, 1);
  // Retain the first durable decision even though no signature was produced.
  exists = true;
  const signature = await decide(source, lock, client);
  assert.equal(verifyMessage(getBytes(releaseMessageHash(lock)), signature), signer.address);
});
