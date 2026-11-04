import { afterEach, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
vi.mock('../db.js', () => ({ query: vi.fn(), slowQuery: vi.fn(), getPool: vi.fn() }));
const { query, slowQuery } = await import('../db.js');
const { explorerRouter } = await import('../routes.js');
afterEach(() => { vi.unstubAllGlobals(); });

it('returns block and gas data when the all-time wallet count times out', async () => {
  vi.mocked(query).mockImplementation(async (sql) => {
    if (sql.includes('MAX(height)')) return [{ height: '123', block_time: new Date() }] as any;
    if (sql.includes('block_height::text AS height')) return [{ height: '120', timestamp: new Date() }] as any;
    if (sql.includes('avg_seconds')) return [{ avg_seconds: '2.5' }] as any;
    return [{ count: '4' }] as any;
  });
  vi.mocked(slowQuery).mockImplementation(async (sql) => {
    if (sql.includes('all_addrs')) throw new Error('canceling statement due to statement timeout');
    return [{ count: '321' }] as any;
  });
  vi.stubGlobal('fetch', vi.fn(async (_url, init) => new Response(JSON.stringify({
    result: init?.method === 'POST' ? '0x7' : { sync_info: { latest_block_height: '124' } },
  }))));
  const response = await request(express().use('/api', explorerRouter())).get('/api/stats/summary');
  expect(response.status).toBe(200);
  expect(response.body).toMatchObject({ tipHeight: 123, gasPriceWei: '7', totalTransactions: 321, walletAddresses: null });
  expect(response.body.unavailableMetrics).toContain('walletAddresses');
});
