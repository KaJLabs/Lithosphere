import { afterEach, describe, expect, it, vi } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';

vi.mock('../db.js', () => ({
  query: vi.fn(),
  slowQuery: vi.fn(),
  getPool: vi.fn(),
}));

const { explorerRouter } = await import('../routes.js');
const { loadQuanttConfig } = await import('../quantt.js');

const QUANTT_ENV_KEYS = [
  'QUANTT_API_BASE_URL',
  'QUANTT_API_KEY',
  'QUANTT_API_AUTH_HEADER',
  'QUANTT_INSIGHTS_PATH',
  'QUANTT_API_TIMEOUT_MS',
] as const;

function makeApp(): Express {
  const app = express();
  app.use(express.json());
  app.use('/api', explorerRouter());
  return app;
}

afterEach(() => {
  for (const key of QUANTT_ENV_KEYS) delete process.env[key];
  vi.unstubAllGlobals();
});

describe('Quantt integration', () => {
  it('stays unavailable until an approved endpoint and key are configured', async () => {
    const app = makeApp();
    const status = await request(app).get('/api/quantt/status').expect(200);
    expect(status.body).toMatchObject({ configured: false, apiOrigin: null });

    const insights = await request(app).get('/api/quantt/insights?symbol=LITHO').expect(503);
    expect(insights.body.message).toContain('not configured');
  });

  it('rejects non-Quantt, non-HTTPS, and malformed upstream configuration', () => {
    expect(loadQuanttConfig({ QUANTT_API_BASE_URL: 'http://api.quantts.ai', QUANTT_API_KEY: 'key' })).toBeNull();
    expect(loadQuanttConfig({ QUANTT_API_BASE_URL: 'https://quantt.at.evil.example', QUANTT_API_KEY: 'key' })).toBeNull();
    expect(loadQuanttConfig({ QUANTT_API_BASE_URL: 'https://api.quantts.ai', QUANTT_API_KEY: 'key', QUANTT_INSIGHTS_PATH: '//evil.example' })).toBeNull();
    expect(loadQuanttConfig({
      QUANTT_API_BASE_URL: 'https://api.quantts.ai?redirect=https://evil.example',
      QUANTT_API_KEY: 'key',
      QUANTT_API_AUTH_HEADER: 'authorization',
      QUANTT_INSIGHTS_PATH: '/v1/partner/market/snapshot',
    })).toBeNull();
  });

  it('requires an explicit approved auth scheme and insights path', () => {
    const base = {
      QUANTT_API_BASE_URL: 'https://api.quantts.ai',
      QUANTT_API_KEY: 'server-secret',
    };
    expect(loadQuanttConfig(base)).toBeNull();
    expect(loadQuanttConfig({ ...base, QUANTT_API_AUTH_HEADER: 'authorization' })).toBeNull();
    expect(loadQuanttConfig({ ...base, QUANTT_INSIGHTS_PATH: '/v1/partner/market/snapshot' })).toBeNull();
    expect(loadQuanttConfig({
      ...base,
      QUANTT_API_AUTH_HEADER: 'cookie',
      QUANTT_INSIGHTS_PATH: '/v1/partner/market/snapshot',
    })).toBeNull();
    expect(loadQuanttConfig({
      ...base,
      QUANTT_API_AUTH_HEADER: 'authorization',
      QUANTT_INSIGHTS_PATH: '/v1/partner/market/snapshot',
    })).toMatchObject({ authHeader: 'Authorization', insightsPath: '/v1/partner/market/snapshot' });
  });

  it('proxies an insight without exposing credentials', async () => {
    process.env.QUANTT_API_BASE_URL = 'https://api.quantts.ai/root/';
    process.env.QUANTT_API_KEY = 'server-secret';
    process.env.QUANTT_API_AUTH_HEADER = 'x-partner-key';
    process.env.QUANTT_INSIGHTS_PATH = '/v1/partner/market/snapshot';
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ symbol: 'LITHO', as_of: '2026-10-13T00:00:00Z', price: 8.7, change_pct_24h: null, volume_24h: null, realized_volatility: null, metadata: { source: 'test' } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    const response = await request(makeApp()).get('/api/quantt/insights?symbol=litho').expect(200);
    expect(response.body).toEqual({
      ok: true,
      provider: 'quantt',
      symbol: 'LITHO',
      data: { symbol: 'LITHO', as_of: '2026-10-13T00:00:00Z', price: 8.7, change_pct_24h: null, volume_24h: null, realized_volatility: null, metadata: { source: 'test' } },
    });
    expect(JSON.stringify(response.body)).not.toContain('server-secret');

    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.toString()).toBe('https://api.quantts.ai/v1/partner/market/snapshot?symbol=LITHO');
    expect(init.headers).toMatchObject({ 'X-Partner-Key': 'server-secret' });
  });

  it('rejects old canonical domains and unsupported authentication', () => {
    expect(loadQuanttConfig({ QUANTT_API_BASE_URL: 'https://api.quantt.at', QUANTT_API_KEY: 'key', QUANTT_API_AUTH_HEADER: 'x-partner-key', QUANTT_INSIGHTS_PATH: '/v1/partner/market/snapshot' })).toBeNull();
  });
  it('reports unsupported symbols and rejects malformed successful snapshots', async () => {
    process.env.QUANTT_API_BASE_URL = 'https://api.quantts.ai';
    process.env.QUANTT_API_KEY = 'server-secret';
    process.env.QUANTT_API_AUTH_HEADER = 'x-partner-key';
    process.env.QUANTT_INSIGHTS_PATH = '/v1/partner/market/snapshot';
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ detail: 'unknown symbol: LITHO' }), { status: 404 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ price: 10, privateToken: 'server-secret' })));
    vi.stubGlobal('fetch', fetchMock);
    const app = makeApp();
    const unknown = await request(app).get('/api/quantt/insights?symbol=LITHO').expect(404);
    expect(unknown.body.message).toContain('does not currently provide');
    const invalid = await request(app).get('/api/quantt/insights?symbol=BTC').expect(502);
    expect(JSON.stringify(invalid.body)).not.toContain('server-secret');
  });
  it('validates asset symbols before calling Quantt', async () => {
    process.env.QUANTT_API_BASE_URL = 'https://api.quantts.ai';
    process.env.QUANTT_API_KEY = 'server-secret';
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await request(makeApp()).get('/api/quantt/insights?symbol=../../admin').expect(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
