export interface LithoMarketPrice {
  price: string | null;
  currency: string;
  source: 'Ignite DEX' | 'Magma DEX' | null;
  kind: 'last trade' | 'reference' | null;
  changePercent24h: number | null;
  updatedAt: string | null;
  tradeUrl: string;
}

const emptyPrice: LithoMarketPrice = {
  price: null, currency: 'USD', source: null, kind: null,
  changePercent24h: null, updatedAt: null, tradeUrl: 'https://ignite.trade',
};

function positiveDecimal(value: unknown): string | null {
  const text = String(value ?? '');
  return /^\d+(?:\.\d+)?$/.test(text) && Number.isFinite(Number(text)) && Number(text) > 0 ? text : null;
}

async function json(url: string): Promise<any> {
  const response = await fetch(url, { signal: AbortSignal.timeout(4000) });
  if (!response.ok) throw new Error('Market data unavailable');
  return response.json();
}

/** Ignite only publishes genuine executions in its rolling 24-hour ticker feed. */
export async function fetchLithoMarketPrice(): Promise<LithoMarketPrice> {
  try {
    const tickers = await json('https://api.ignite.trade/v1/market-data/tickers');
    if (Array.isArray(tickers)) {
      for (const quote of ['USD', 'USDT', 'USDC']) {
        const ticker = tickers.find((t) => t.base_currency === 'LITHO' && t.target_currency === quote &&
          t.ticker_id === `LITHO_${quote}` && positiveDecimal(t.last_price));
        if (ticker) return {
          price: positiveDecimal(ticker.last_price), currency: quote, source: 'Ignite DEX', kind: 'last trade',
          changePercent24h: null, updatedAt: new Date().toISOString(),
          tradeUrl: `https://ignite.trade/trade/LITHO_${quote}`,
        };
      }
    }
  } catch { /* Try Magma's public ticker. */ }

  try {
    const ticker = await json('https://api.magmadex.trade/api/ticker/LITHO-USDT');
    const price = positiveDecimal(ticker.lastPrice);
    const timestamp = Number(ticker.timestamp);
    const age = Date.now() - timestamp;
    // Magma's reference feed can retain old values when an upstream stops.
    if (ticker.symbol === 'LITHO-USDT' && price && Number.isFinite(timestamp) && age >= -60_000 && age < 15 * 60_000) {
      return {
        price, currency: 'USDT', source: 'Magma DEX', kind: 'reference',
        changePercent24h: typeof ticker.changePercent24h === 'number' && Number.isFinite(ticker.changePercent24h)
          ? ticker.changePercent24h : null,
        updatedAt: new Date(timestamp).toISOString(), tradeUrl: 'https://magmadex.trade',
      };
    }
  } catch { /* Return an honest unavailable state, never a seeded or stale price. */ }
  return { ...emptyPrice };
}

export async function fetchNativeSupply(): Promise<string | null> {
  const lcd = (process.env.REST_URL || process.env.LCD_URL ||
    (process.env.NETWORK === 'mainnet' ? 'https://api-mainnet.litho.ai' : 'https://api.litho.ai')).replace(/\/$/, '');
  try {
    const data = await json(`${lcd}/cosmos/bank/v1beta1/supply/by_denom?denom=ulitho`);
    return data.amount?.denom === 'ulitho' && /^\d+$/.test(data.amount?.amount) ? data.amount.amount : null;
  } catch { return null; }
}
