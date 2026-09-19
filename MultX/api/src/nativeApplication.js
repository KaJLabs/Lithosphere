import express from 'express';
import cors from 'cors';
import { createNativeRegistry } from './services/nativeRegistry.js';
import { createNativeQuoteRouter } from './routes/nativeQuote.js';
import { createNativeSourceRouter } from './routes/nativeSource.js';
import { createNativeDestinationRouter } from './routes/nativeDestination.js';

// Explicit application assembly for integration/staging. Production startup does
// not call this until deployment, ingress, custody and audit gates are approved.
export function createNativeApplication({ pool, providers, sourcePolicies, audience, allowedOrigins }) {
  if (!Array.isArray(allowedOrigins) || !allowedOrigins.length || allowedOrigins.some(origin => {
    try { const url = new URL(origin); return url.origin !== origin || url.username || url.password ||
      !(url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost','127.0.0.1','[::1]'].includes(url.hostname))); }
    catch { return true; }
  })) throw Error('exact approved native application origins required');
  const registry = createNativeRegistry({ pool, providers, sourcePolicies });
  const app = express();
  app.disable('x-powered-by');
  app.use(cors({origin:(origin, callback)=>callback(null, !origin || allowedOrigins.includes(origin)), methods:['GET','POST'],
    allowedHeaders:['content-type','x-multx-time','x-multx-nonce','x-multx-signature'], maxAge:600}));
  app.use('/native-quotes', createNativeQuoteRouter({pool, registry:registry.quotes, audience}));
  app.use('/native-source', createNativeSourceRouter({pool, registry:registry.source, audience}));
  app.use('/native-destination', createNativeDestinationRouter({pool, registry:registry.destination, audience}));
  return app;
}
