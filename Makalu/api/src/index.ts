import 'dotenv/config';
import express, { type NextFunction, type Request, type Response } from 'express';
import cors from 'cors';
import { ApolloServer } from 'apollo-server-express';
import { typeDefs, resolvers } from './schema.js';
import { lithoRouter } from './litho.js';
import { explorerRouter } from './routes.js';
import { register, collectDefaultMetrics } from 'prom-client';

// Collect default metrics (CPU, memory, etc.)
collectDefaultMetrics({ prefix: 'litho_api_' });

const app = express();
const EXPLORER_INTERNAL_URL = process.env.EXPLORER_INTERNAL_URL || 'http://explorer:3000';
const STRIPPED_PROXY_HEADERS = new Set([
  'connection',
  'content-encoding',
  'content-length',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

function buildExplorerProxyHeaders(req: Request): Record<string, string> {
  const headers: Record<string, string> = {};

  for (const [key, value] of Object.entries(req.headers)) {
    if (!value) continue;
    headers[key] = Array.isArray(value) ? value.join(', ') : value;
  }

  const forwardedHost = typeof req.headers.host === 'string' ? req.headers.host : 'makalu.litho.ai';
  const forwardedFor = req.headers['x-forwarded-for'];

  headers['x-forwarded-host'] = forwardedHost;
  headers['x-forwarded-proto'] = req.protocol;

  if (req.ip) {
    headers['x-forwarded-for'] =
      typeof forwardedFor === 'string' && forwardedFor.length > 0
        ? `${forwardedFor}, ${req.ip}`
        : req.ip;
  }

  return headers;
}

async function proxyExplorerRequest(req: Request, res: Response) {
  const target = new URL(req.originalUrl, EXPLORER_INTERNAL_URL);
  const upstream = await fetch(target, {
    method: req.method,
    headers: buildExplorerProxyHeaders(req),
    redirect: 'manual',
  });

  res.status(upstream.status);
  upstream.headers.forEach((value, key) => {
    if (!STRIPPED_PROXY_HEADERS.has(key.toLowerCase())) {
      res.setHeader(key, value);
    }
  });

  if (req.method === 'HEAD') {
    res.end();
    return;
  }

  const body = Buffer.from(await upstream.arrayBuffer());
  res.end(body);
}

app.use(cors());
app.use(express.json());

// Health check endpoint for deployment verification
app.get('/health', (_req, res) => {
  res.status(200).json({
    status: 'healthy',
    service: 'lithosphere-api',
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || '1.0.0',
    environment: process.env.NODE_ENV || 'development',
  });
});

// Readiness probe (checks dependencies)
app.get('/ready', async (_req, res) => {
  try {
    // Add database connectivity check here if needed
    res.status(200).json({ ready: true });
  } catch (error) {
    res.status(503).json({ ready: false, error: 'Dependencies not ready' });
  }
});

app.use('/api/litho', lithoRouter());
app.use('/api', explorerRouter());

// Metrics server on port 9090
const metricsApp = express();
metricsApp.get('/metrics', async (_req, res) => {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
});

const metricsPort = process.env.METRICS_PORT || 9090;
metricsApp.listen(metricsPort, () => {
  console.log(`Metrics server running on :${metricsPort}`);
});

async function start() {
  const server = new ApolloServer({ typeDefs, resolvers });
  await server.start();
  server.applyMiddleware({ app: app as any, path: '/graphql' });

  // The public edge currently reaches the API for non-API routes.
  // Proxy those GET/HEAD requests to the explorer so makalu.litho.ai still serves the site.
  app.use(async (req: Request, res: Response, next: NextFunction) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      next();
      return;
    }

    try {
      await proxyExplorerRequest(req, res);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error(`[explorer-proxy] ${req.method} ${req.originalUrl} failed: ${message}`);
      res.status(502).json({
        error: 'Explorer unavailable',
        message: 'Could not reach the explorer frontend.',
      });
    }
  });

  const port = process.env.API_PORT || 4000;
  app.listen(port, () => console.log(`API running on :${port}`));
}
start();
