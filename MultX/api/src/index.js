import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import swaggerUi from 'swagger-ui-express';
import { config } from './config.js';
import { pool } from './db/pool.js';
import { runMigrations } from './db/migrate.js';
import { startEventListener } from './services/eventListener.js';
import { startMockValidator } from './services/mockValidator.js';
import { startValidatorService } from './services/validatorService.js';
import { startReleaseService, stopReleaseService } from './services/releaseService.js';
import errorHandler from './middleware/errorHandler.js';
import bridgeRoutes from './routes/bridge.js';
import tokensRoutes from './routes/tokens.js';
import chainsRoutes from './routes/chains.js';
import healthRoutes from './routes/health.js';
import metricsRouter, { httpRequestsTotal, httpRequestDuration } from './routes/metrics.js';
import { instrumentHttpRequest } from './middleware/httpMetrics.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

if (process.env.NODE_ENV === 'production') {
  const trustProxyHops = Number(process.env.TRUST_PROXY_HOPS);
  if (!Number.isSafeInteger(trustProxyHops) || trustProxyHops < 1 || trustProxyHops > 3) {
    throw new Error('TRUST_PROXY_HOPS must explicitly identify 1-3 trusted production proxy hops');
  }
  app.set('trust proxy', trustProxyHops);
}

// Middleware
app.use(cors({ origin: config.corsOrigins }));
app.use(express.json());

// Prometheus request instrumentation
app.use(instrumentHttpRequest(httpRequestsTotal, httpRequestDuration));

// Global rate limiter: 100 req / 60s / IP
const limiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max:      config.rateLimit.max,
  standardHeaders: true,
  legacyHeaders:   false,
  message: { error: 'Too many requests — please slow down.' },
});
app.use(limiter);

// Swagger UI at /docs
const openapiSpec = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'openapi.json'), 'utf-8')
);
app.use('/docs', swaggerUi.serve, swaggerUi.setup(openapiSpec, {
  customSiteTitle: 'MultX Bridge API — Docs',
}));

// Routes
app.use('/bridge',   bridgeRoutes);
app.use('/tokens',   tokensRoutes);
app.use('/chains',   chainsRoutes);
app.use('/health',   healthRoutes);
app.use('/metrics',  metricsRouter);

// Error handler
app.use(errorHandler);

// Startup sequence
async function startup() {
  try {
    // 1. Run migrations
    console.log('[Startup] Running database migrations...');
    const migrationDir = path.join(__dirname, 'db', 'migrations');
    const migrations = await runMigrations(pool, migrationDir);
    console.log(`[Startup] Applied ${migrations.applied.length} migrations; ${migrations.alreadyApplied} already recorded.`);

    // 2. Start event listener
    console.log('[Startup] Starting event listener...');
    await startEventListener();

    // 3. Start validator service (mock for dev, real for production)
    if (config.useMockValidator) {
      console.log('[Startup] Starting mock validator (MOCK_VALIDATOR=true)...');
      await startMockValidator();
    } else {
      console.log('[Startup] Starting production validator service...');
      await startValidatorService();
    }

    // 4. Start release executor (no-op unless RELAYER_PRIVATE_KEY is set)
    console.log('[Startup] Starting release executor...');
    await startReleaseService();

    // 5. Start server
    app.listen(config.port, () => {
      console.log(`[Startup] Server running on port ${config.port}`);
      console.log(`[Startup] Docs:    http://localhost:${config.port}/docs`);
      console.log(`[Startup] Metrics: http://localhost:${config.port}/metrics`);
      console.log(`[Startup] CORS origins: ${config.corsOrigins.join(', ')}`);
    });
  } catch (err) {
    console.error('[Startup] Fatal error:', err.message);
    process.exit(1);
  }
}

startup();

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('[Shutdown] Stopping release executor...');
  stopReleaseService();
  console.log('[Shutdown] Closing database pool...');
  await pool.end();
  process.exit(0);
});
