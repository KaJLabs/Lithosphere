import test from 'node:test';
import assert from 'node:assert/strict';
import { submitSourceVerifiedRelease } from '../src/services/releaseService.js';
import { resolveReleaseToken } from '../src/config.js';

test('automated submission is withheld for orphaned evidence and allowed for current evidence', async () => {
  const token = '0xC0FC628e3aB128fe387e7ed5e729bD809C017888';
  const bridge = `0x${'11'.repeat(20)}`, user = `0x${'22'.repeat(20)}`, hash = `0x${'ab'.repeat(32)}`;
  const row = { source_chain: 900523, source_bridge: bridge, block_number: 100, block_hash: hash,
    tx_hash: `0x${'cd'.repeat(32)}`, token_address: token, from_address: user, amount: '10',
    target_chain: 11155111, source_nonce: '7', release_token: resolveReleaseToken(900523, token, 11155111) };
  const source = { chainId: 900523, bridgeAddress: bridge, confirmations: 12 };
  let missing = true, submitted = 0;
  const client = { provider: { getNetwork: async () => ({ chainId: 900523n }), getBlockNumber: async () => 111,
    getBlock: async () => ({ hash }) }, contract: { filters: { TokensLocked: () => ({}) }, queryFilter: async () => missing ? [] : [{
      address: bridge, blockNumber: 100, blockHash: hash, args: { txHash: row.tx_hash, token, user, amount: 10n, targetChain: 11155111n, nonce: 7n },
    }] } };
  const submit = async () => { submitted++; return 'submitted'; };
  await assert.rejects(submitSourceVerifiedRelease(row, submit, source, client), /missing or ambiguous/);
  assert.equal(submitted, 0);
  missing = false;
  assert.equal(await submitSourceVerifiedRelease(row, submit, source, client), 'submitted');
  assert.equal(submitted, 1);
  await assert.rejects(submitSourceVerifiedRelease({ ...row, block_hash: null }, submit, source, client), /Missing or unmapped/);
  assert.equal(submitted, 1);
});
