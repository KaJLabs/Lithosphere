#!/usr/bin/env tsx
/**
 * Introspect the Express routers registered in src/index.ts and emit a sorted
 * JSON list of full routes ({ method, path }) to stdout.
 *
 * Mount points (kept in sync with src/index.ts):
 *   /api/litho  ← lithoRouter()
 *   /api        ← explorerRouter()
 *
 * Express's Router exposes a `.stack` of Layer objects; each Layer with a
 * `.route` represents a registered HTTP handler. We walk both routers without
 * starting a server (no pg pool is created — db.ts uses a lazy getPool()).
 *
 * Consumed by `verify-openapi-in-sync.ts` as the source-of-truth route list.
 */
import { explorerRouter } from '../src/routes.js';
import { lithoRouter } from '../src/litho.js';
import { nativeContractRouter } from '../src/native/contracts.js';

interface Route {
  method: string;
  path: string;
}

interface ExpressRouter {
  stack: Array<{
    route?: {
      path: string;
      methods: Record<string, boolean>;
    };
  }>;
}

function collect(router: unknown, prefix: string): Route[] {
  const out: Route[] = [];
  const stack = (router as ExpressRouter).stack ?? [];
  for (const layer of stack) {
    if (!layer.route) continue;
    const fullPath = prefix + layer.route.path;
    for (const [method, enabled] of Object.entries(layer.route.methods)) {
      if (enabled && method !== '_all') {
        out.push({ method: method.toUpperCase(), path: fullPath });
      }
    }
  }
  return out;
}

const routes: Route[] = [
  ...collect(lithoRouter(), '/api/litho'),
  ...collect(explorerRouter(), '/api'),
  // collect() intentionally reads direct routes only; include the native mount.
  ...collect(nativeContractRouter(), '/api/native'),
].sort((a, b) =>
  a.path === b.path ? a.method.localeCompare(b.method) : a.path.localeCompare(b.path)
);

process.stdout.write(JSON.stringify(routes, null, 2));
process.stdout.write('\n');
