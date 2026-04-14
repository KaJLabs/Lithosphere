import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import { fileURLToPath } from 'url';
import path from 'path';
import { config } from './config.js';
import { dripRoutes } from './routes/drip.js';
import { healthRoutes } from './routes/health.js';
import { closeRedis } from './services/rateLimit.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = Fastify({ logger: true });

await app.register(cors, { origin: true });

// Serve frontend static files
await app.register(fastifyStatic, {
  root: path.join(__dirname, '..', 'frontend'),
  prefix: '/',
});

// Routes
await app.register(healthRoutes);
await app.register(dripRoutes);

// Graceful shutdown
const shutdown = async () => {
  console.log('[faucet] Shutting down...');
  await closeRedis();
  await app.close();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// Start
try {
  await app.listen({ port: config.port, host: config.host });
  const assetSummary = config.assets
    .map((asset) => `${asset.symbol} [${asset.allowedAmounts.join('/')}]`)
    .join(' | ');
  console.log(`[faucet] Listening on http://${config.host}:${config.port}`);
  console.log(`[faucet] RPC: ${config.rpcUrl} | Chain: ${config.chainId}`);
  console.log(`[faucet] Assets: ${assetSummary} | Cooldown: ${config.cooldownHours}h`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
