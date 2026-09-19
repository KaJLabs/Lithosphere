import express from 'express';
import rateLimit from 'express-rate-limit';
import { acceptNativeQuote, createNativeQuote } from '../services/nativeQuote.js';
import { consumeNativeWalletNonce, verifyNativeWalletRequest } from '../services/nativeWalletAuth.js';

const quoteKeys = ['destinationChain', 'inputAmount', 'minimumOutput', 'recipient', 'sourceChain'];

function exactKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).sort().join(',') === keys.slice().sort().join(',');
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
    try {
      const auth = verifyNativeWalletRequest({ audience, domain: 'MultX quote request v1', req, body });
      wallet = auth.wallet;
      await consumeNativeWalletNonce(pool, { audience, ...auth });
    }
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
    try {
      const auth = verifyNativeWalletRequest({ audience, domain: 'MultX quote request v1', req, body });
      wallet = auth.wallet;
      await consumeNativeWalletNonce(pool, { audience, ...auth });
    }
    catch { return res.status(401).json({ error: 'invalid_wallet_auth' }); }
    try { return res.json(await acceptNativeQuote(pool, req.params.quoteId, wallet, registry)); }
    catch { return res.status(409).json({ error: 'quote_acceptance_rejected' }); }
  });
  return router;
}
