#!/usr/bin/env tsx
/**
 * Drift gate for `docs/api-reference/openapi.yaml`.
 *
 * Compares the set of routes registered in src/{routes,litho}.ts (via the
 * Express introspection in `list-routes.ts`) against the `paths:` keys in
 * the committed OpenAPI artifact. Fails on either direction of drift:
 *
 *   - Route registered in code but missing from OpenAPI → "Document <X>"
 *   - Path documented in OpenAPI but no matching route → "Remove stale <X>"
 *
 * Normalisation:
 *   - Strips the `/api` server prefix from code routes before comparing
 *     (OpenAPI `servers[0].url` ends in `/api`, so paths there are relative).
 *   - Express `:param` ↔ OpenAPI `{param}`.
 *   - Same `(METHOD, path)` tuple is compared on both sides — a path
 *     documented with the wrong HTTP method counts as drift.
 *
 * Schema drift (response bodies, query params) is NOT checked here — those
 * are enforced by tests, not by this file. The gate's only job is the
 * route SET. Same minimalist stance as the GraphQL drift gate.
 *
 * Hand-parses the OpenAPI YAML to avoid a transitive dep on the
 * license-check'd `js-yaml` package (same pattern as
 * `scripts/check-licenses.mjs`). Only reads `paths:` keys and their HTTP
 * method children; rich YAML features aren't needed.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { explorerRouter } from '../src/routes.js';
import { lithoRouter } from '../src/litho.js';
import { nativeContractRouter } from '../src/native/contracts.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const openapiPath = resolve(__dirname, '..', '..', '..', 'docs', 'api-reference', 'openapi.yaml');

const API_PREFIX = '/api';
const HTTP_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD']);

interface ExpressRouter {
  stack: Array<{ route?: { path: string; methods: Record<string, boolean> } }>;
}

interface Endpoint {
  method: string;
  path: string;
}

function collectRoutes(router: unknown, prefix: string): Endpoint[] {
  const out: Endpoint[] = [];
  for (const layer of (router as ExpressRouter).stack ?? []) {
    if (!layer.route) continue;
    const full = prefix + layer.route.path;
    for (const [method, on] of Object.entries(layer.route.methods)) {
      if (on && method !== '_all') out.push({ method: method.toUpperCase(), path: full });
    }
  }
  return out;
}

/** Convert an Express path (`/blocks/:height`) to OpenAPI form (`/blocks/{height}`). */
function expressToOpenapi(path: string): string {
  return path.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
}

/** Strip the `/api` server prefix; OpenAPI paths are relative to servers[0].url. */
function stripPrefix(path: string): string {
  if (!path.startsWith(API_PREFIX)) return path;
  const rest = path.slice(API_PREFIX.length);
  return rest === '' ? '/' : rest;
}

/**
 * Parse OpenAPI YAML just enough to extract { method, path } tuples.
 *
 * Recognised shape:
 *   paths:
 *     /some/path:
 *       get:
 *         summary: ...
 *       post:
 *         ...
 *
 * Indentation is the structural signal: 2-space keys under `paths:` are
 * path entries; 4-space keys under a path entry are HTTP methods.
 */
function parseOpenapiPaths(yaml: string): Endpoint[] {
  const out: Endpoint[] = [];
  const lines = yaml.split(/\r?\n/);
  let inPaths = false;
  let currentPath: string | null = null;

  for (const raw of lines) {
    // Skip blank / comment lines outright.
    if (!raw.trim() || raw.trim().startsWith('#')) continue;

    if (!inPaths) {
      if (/^paths:\s*$/.test(raw)) inPaths = true;
      continue;
    }

    // A top-level key at column 0 ends the paths: section.
    if (/^[A-Za-z]/.test(raw)) break;

    // Two-space-indented key under paths: → a path entry (`  /foo:`).
    const pathMatch = raw.match(/^ {2}(\S[^:]*):\s*$/);
    if (pathMatch) {
      currentPath = pathMatch[1].trim();
      continue;
    }

    // Four-space-indented key under a path entry → an HTTP method.
    const methodMatch = raw.match(/^ {4}([a-z]+):\s*$/);
    if (methodMatch && currentPath) {
      const method = methodMatch[1].toUpperCase();
      if (HTTP_METHODS.has(method)) {
        out.push({ method, path: currentPath });
      }
    }
  }

  return out;
}

const codeRoutes: Endpoint[] = [
  ...collectRoutes(lithoRouter(), '/api/litho'),
  ...collectRoutes(explorerRouter(), '/api'),
  ...collectRoutes(nativeContractRouter(), '/api/native'),
].map((r) => ({ method: r.method, path: stripPrefix(expressToOpenapi(r.path)) }));

const yaml = readFileSync(openapiPath, 'utf8');
const docRoutes = parseOpenapiPaths(yaml);

function key(e: Endpoint): string {
  return `${e.method} ${e.path}`;
}

const codeKeys = new Set(codeRoutes.map(key));
const docKeys = new Set(docRoutes.map(key));

const undocumented = [...codeKeys].filter((k) => !docKeys.has(k)).sort();
const stale = [...docKeys].filter((k) => !codeKeys.has(k)).sort();

if (undocumented.length === 0 && stale.length === 0) {
  console.log(`OpenAPI route set is in sync (${codeKeys.size} endpoints).`);
  process.exit(0);
}

console.error('OpenAPI drift detected.');
console.error('');
if (undocumented.length > 0) {
  console.error(`Routes registered in code but missing from openapi.yaml (${undocumented.length}):`);
  for (const k of undocumented) console.error(`  + ${k}`);
  console.error('');
}
if (stale.length > 0) {
  console.error(`Paths documented in openapi.yaml but not registered in code (${stale.length}):`);
  for (const k of stale) console.error(`  - ${k}`);
  console.error('');
}
console.error('To fix:');
console.error('  - For undocumented routes: add a `paths:` entry to docs/api-reference/openapi.yaml');
console.error('  - For stale paths: either restore the handler or delete the openapi entry');
console.error("  - Re-list to confirm: cd Makalu/api && pnpm exec tsx scripts/list-routes.ts");
process.exit(1);
