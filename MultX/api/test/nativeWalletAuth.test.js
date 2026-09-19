import test from 'node:test';
import assert from 'node:assert/strict';
import { ethers } from 'ethers';
import { consumeNativeWalletNonce, verifyNativeWalletRequest } from '../src/services/nativeWalletAuth.js';

async function signedRequest(overrides = {}) {
  const signer = overrides.signer ?? ethers.Wallet.createRandom();
  const audience = 'review.example';
  const domain = 'MultX quote request v1';
  const method = 'POST';
  const path = '/';
  const body = '{}';
  const timestamp = String(Date.now());
  const nonce = '0x' + 'ab'.repeat(32);
  const message = domain + '\n' + JSON.stringify([
    audience, method, path, ethers.keccak256(ethers.toUtf8Bytes(body)), timestamp, nonce,
  ]);
  const headers = {
    'x-multx-nonce': nonce,
    'x-multx-time': timestamp,
    'x-multx-signature': await signer.signMessage(message),
    ...overrides.headers,
  };
  return {
    audience,
    domain,
    body,
    signer,
    req: { method, path, get: name => headers[name] },
  };
}

test('wallet authentication binds the request and recovers its signer', async () => {
  const value = await signedRequest();
  const auth = verifyNativeWalletRequest(value);
  assert.equal(auth.wallet, value.signer.address.toLowerCase());
  assert.equal(auth.nonce, '0x' + 'ab'.repeat(32));
  assert.notEqual(
    verifyNativeWalletRequest({ ...value, body: '{"changed":true}' }).wallet,
    value.signer.address.toLowerCase(),
  );
});

test('nonce consumption atomically prunes expired rows and rejects replay', async () => {
  const calls = [];
  const pool = { query: async (sql, values) => {
    calls.push({ sql, values });
    return { rowCount: calls.length === 1 ? 1 : 0 };
  } };
  const input = { audience: 'review.example', wallet: ethers.Wallet.createRandom().address.toLowerCase(), nonce: '0x' + 'cd'.repeat(32) };
  await consumeNativeWalletNonce(pool, input);
  assert.match(calls[0].sql, /DELETE FROM native_wallet_auth_nonces/);
  assert.match(calls[0].sql, /interval '2 minutes'/);
  assert.match(calls[0].sql, /ON CONFLICT DO NOTHING/);
  assert.deepEqual(calls[0].values, [input.audience, input.wallet, input.nonce]);
  await assert.rejects(consumeNativeWalletNonce(pool, input), /replayed wallet auth/);
});
