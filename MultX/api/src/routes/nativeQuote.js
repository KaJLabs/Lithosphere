import express from 'express';
import rateLimit from 'express-rate-limit';
import { ethers } from 'ethers';
import { acceptNativeQuote, createNativeQuote } from '../services/nativeQuote.js';

const quoteKeys = ['destinationChain', 'inputAmount', 'minimumOutput', 'recipient', 'sourceChain'];

function exactKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).sort().join(',') === keys.slice().sort().join(',');
}

async function authenticate(pool, audience, req, body) {
  const nonce = req.get('x-multx-nonce');
  const timestamp = req.get('x-multx-time');
  const signature = req.get('x-multx-signature');
  if (!/^0x[0-9a-f]{64}$/.test(nonce ?? '') || !/^[0-9]{13}$/.test(timestamp ?? '') ||
      !/^0x[0-9a-f]{130}$/i.test(signature ?? '')) throw Error('invalid auth');
  const age = Date.now() - Number(timestamp);
  if (age < -5000 || age > 60000) throw Error('invalid auth');
  const message = 'MultX quote request v1\n' + JSON.stringify([
    audience, req.method, req.path, ethers.keccak256(ethers.toUtf8Bytes(body)), timestamp, nonce,
  ]);
  const wallet = ethers.verifyMessage(message, signature).toLowerCase();
  const consumed = await pool.query(
    'INSERT INTO native_wallet_auth_nonces(audience,wallet,nonce) VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING nonce',
    [audience, wallet, nonce],
  );
  if (!consumed.rowCount) throw Error('replayed auth');
  return wallet;
}

// Mounted only by a reviewed application. The registry maps a user request to
// operator-approved source and route policies; request data cannot create policy.
export function createNativeQuoteRouter({ pool, registry, audience }) {
  if (typeof audience !== 'string' || !audience.trim() || audience.length > 200 ||
      typeof registry?.resolve !== 'function') throw Error('native quote registry and audience required');
  const router = express.Router();
  router.use(rateLimit({ windowMs: 60000, limit: 30, standardHeaders: true, legacyHeaders: false }));
  router.use(express.json({ limit: '4kb' }));

  router.post('/', async (req, res) => {
    if (!exactKeys(req.body, quoteKeys)) return res.status(400).json({ error: 'invalid_quote_body' });
    const body = JSON.stringify(req.body);
    let wallet;
    try { wallet = await authenticate(pool, audience, req, body); }
    catch { return res.status(401).json({ error: 'invalid_wallet_auth' }); }
    try {
      const selected = await registry.resolve(req.body, wallet);
      const quote = await createNativeQuote(pool, selected.provider, selected.policyId, selected.sourceInputPolicy, { ...req.body, wallet }, selected.destinationProvider);
      return res.status(201).json(quote);
    } catch { return res.status(409).json({ error: 'quote_unavailable' }); }
  });

  router.post('/:quoteId/accept', async (req, res) => {
    if (JSON.stringify(req.body ?? {}) !== '{}') return res.status(400).json({ error: 'invalid_accept_body' });
    const body = '{}';
    let wallet;
    try { wallet = await authenticate(pool, audience, req, body); }
    catch { return res.status(401).json({ error: 'invalid_wallet_auth' }); }
    try { return res.json(await acceptNativeQuote(pool, req.params.quoteId, wallet, registry)); }
    catch { return res.status(409).json({ error: 'quote_acceptance_rejected' }); }
  });
  return router;
}
