import { ethers } from 'ethers';

const NONCE_PATTERN = /^0x[0-9a-f]{64}$/;
const TIMESTAMP_PATTERN = /^[0-9]{13}$/;
const SIGNATURE_PATTERN = /^0x[0-9a-f]{130}$/i;
const MAX_PAST_AGE_MS = 60_000;
const MAX_FUTURE_SKEW_MS = 5_000;

export function verifyNativeWalletRequest({ audience, domain, req, body }) {
  const nonce = req.get('x-multx-nonce');
  const timestamp = req.get('x-multx-time');
  const signature = req.get('x-multx-signature');
  if (!NONCE_PATTERN.test(nonce ?? '') || !TIMESTAMP_PATTERN.test(timestamp ?? '') ||
      !SIGNATURE_PATTERN.test(signature ?? '')) throw Error('invalid wallet auth');
  const age = Date.now() - Number(timestamp);
  if (age < -MAX_FUTURE_SKEW_MS || age > MAX_PAST_AGE_MS) throw Error('invalid wallet auth');
  const message = domain + '\n' + JSON.stringify([
    audience, req.method, req.path, ethers.keccak256(ethers.toUtf8Bytes(body)), timestamp, nonce,
  ]);
  return { wallet: ethers.verifyMessage(message, signature).toLowerCase(), nonce };
}

export async function consumeNativeWalletNonce(pool, { audience, wallet, nonce }) {
  // A request timestamp is accepted for at most 60 seconds with five seconds of
  // future skew. Two minutes retains every replay-relevant nonce while bounding
  // storage. The used_at index keeps opportunistic pruning bounded by age.
  const consumed = await pool.query(
    `WITH pruned AS (
       DELETE FROM native_wallet_auth_nonces
       WHERE used_at < clock_timestamp() - interval '2 minutes'
     )
     INSERT INTO native_wallet_auth_nonces(audience,wallet,nonce)
     VALUES($1,$2,$3)
     ON CONFLICT DO NOTHING
     RETURNING nonce`,
    [audience, wallet, nonce],
  );
  if (!consumed.rowCount) throw Error('replayed wallet auth');
}
