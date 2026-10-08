import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { createNativeVaultStatusReader } from './services/nativeVaultStatus.js';

// Separate, read-only R4 vault surface. Normal API startup does not mount it.
export function createNativeVaultStatusApplication({ routes, providers, allowedOrigins, contractFactory }) {
  if (!Array.isArray(allowedOrigins) || !allowedOrigins.length || allowedOrigins.some(origin => {
    try {
      const url = new URL(origin);
      return url.origin !== origin || url.username || url.password ||
        !(url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)));
    } catch { return true; }
  })) throw Error('exact native vault status origins required');
  const readStatus = createNativeVaultStatusReader({ routes, providers, contractFactory });
  const app = express();
  app.disable('x-powered-by');
  app.use(cors({ origin: (origin, callback) => callback(null, !origin || allowedOrigins.includes(origin)), methods: ['GET'] }));
  app.use(rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: 'draft-8', legacyHeaders: false }));
  app.get('/native-vault/operations/:sourceChainId/:destinationChainId/:operationId', async (req, res) => {
    res.set('cache-control', 'no-store');
    const source = Number(req.params.sourceChainId);
    const destination = Number(req.params.destinationChainId);
    if (!Number.isSafeInteger(source) || !Number.isSafeInteger(destination) ||
        !/^0x[0-9a-fA-F]{64}$/.test(req.params.operationId)) {
      return res.status(400).json({ error: 'invalid native vault operation request' });
    }
    try {
      const status = await readStatus(source, destination, req.params.operationId);
      return res.json(status);
    } catch (error) {
      const unavailable = /RPC|runtime|anchor|route changed|state mismatch|terminal states/.test(error.message);
      const missing = /not found|not approved/.test(error.message);
      return res.status(unavailable ? 503 : missing ? 404 : 503).json({
        error: unavailable ? 'native vault status unavailable' : missing ? 'native vault operation unavailable' : 'native vault status unavailable',
      });
    }
  });
  return app;
}
