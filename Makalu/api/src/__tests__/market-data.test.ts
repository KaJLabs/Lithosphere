import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchLithoMarketPrice } from '../market-data.js';
const response = (data: unknown) => new Response(JSON.stringify(data));
afterEach(() => { vi.unstubAllGlobals(); });
describe('LITHO DEX prices', () => {
  it('selects LITHO, preserves price decimals, and does not treat LAX as USD', async () => {
    const fetcher = vi.fn().mockResolvedValue(response([
      { ticker_id: 'LITHO_LAX', base_currency: 'LITHO', target_currency: 'LAX', last_price: '999' },
      { ticker_id: 'LITHO_USDT', base_currency: 'LITHO', target_currency: 'USDT', last_price: '0.123456789012345678' },
    ]));
    vi.stubGlobal('fetch', fetcher);
    expect(await fetchLithoMarketPrice()).toMatchObject({ price: '0.123456789012345678', currency: 'USDT', source: 'Ignite DEX', kind: 'last trade' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('falls back to a fresh Magma reference price when Ignite has no executions', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(response([])).mockResolvedValueOnce(response({
      symbol: 'LITHO-USDT', lastPrice: 8.7, timestamp: Date.now(), changePercent24h: -2,
    })));
    expect(await fetchLithoMarketPrice()).toMatchObject({ price: '8.7', source: 'Magma DEX', kind: 'reference', changePercent24h: -2 });
  });
  it('does not publish stale Magma values as live prices', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(response([])).mockResolvedValueOnce(response({
      symbol: 'LITHO-USDT', lastPrice: 8.7, timestamp: Date.now() - 86400_000,
    })));
    expect(await fetchLithoMarketPrice()).toMatchObject({ price: null, source: null });
  });
  it('handles both providers being unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    expect(await fetchLithoMarketPrice()).toMatchObject({ price: null });
  });
});
