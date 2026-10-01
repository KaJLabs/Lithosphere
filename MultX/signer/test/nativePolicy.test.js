import assert from 'node:assert/strict';
import test from 'node:test';
import { parseNativeSignerPolicy, resolveNativeChain } from '../src/nativePolicy.js';

const A = '0x1111111111111111111111111111111111111111';
const B = '0x2222222222222222222222222222222222222222';
const Q = '0x3333333333333333333333333333333333333333';

test('parses an exact native signer allowlist', () => {
  const policy = parseNativeSignerPolicy({
    quoteSigner: Q, authorityEpoch: `0x${'ab'.repeat(32)}`,
    chains: [
      { chainId: 1, rpcUrl: 'https://rpc.example/', vault: A, confirmations: 3, finalityDelaySeconds: 60 },
      { chainId: 56, rpcUrl: 'http://127.0.0.1:8545', vault: B, confirmations: 4, finalityDelaySeconds: 90 },
    ],
  });
  assert.equal(resolveNativeChain(policy, 1, A).confirmations, 3);
  assert.throws(() => resolveNativeChain(policy, 1, B), /not approved/);
  assert.throws(() => resolveNativeChain(policy, 8453), /not approved/);
});

test('rejects unsafe native RPC and ambiguous chain policy', () => {
  const base = {
    quoteSigner: Q, authorityEpoch: `0x${'ab'.repeat(32)}`,
    chains: [
      { chainId: 1, rpcUrl: 'http://remote.example', vault: A, confirmations: 3, finalityDelaySeconds: 60 },
      { chainId: 1, rpcUrl: 'https://rpc.example', vault: B, confirmations: 3, finalityDelaySeconds: 60 },
    ],
  };
  assert.throws(() => parseNativeSignerPolicy(base), /HTTPS or loopback HTTP/);
  base.chains[0].rpcUrl = 'https://rpc-one.example';
  assert.throws(() => parseNativeSignerPolicy(base), /duplicates another chain/);
});
