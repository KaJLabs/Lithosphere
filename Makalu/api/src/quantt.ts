export const QUANTT_RESEARCH_URL = 'https://quantts.ai/';
export const QUANTT_DEVELOPER_URL = 'https://api.quantts.ai/docs';

export type QuanttAuthHeader = 'Authorization' | 'X-API-Key' | 'X-Partner-Key';

export interface QuanttConfig {
  baseUrl: URL;
  apiKey: string;
  authHeader: QuanttAuthHeader;
  insightsPath: string;
  timeoutMs: number;
}

function isQuanttHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return normalized === 'api.quantts.ai';
}

export function loadQuanttConfig(env: NodeJS.ProcessEnv = process.env): QuanttConfig | null {
  const rawBaseUrl = env.QUANTT_API_BASE_URL?.trim();
  const apiKey = env.QUANTT_API_KEY?.trim();
  if (!rawBaseUrl || !apiKey) return null;

  let baseUrl: URL;
  try {
    baseUrl = new URL(rawBaseUrl);
  } catch {
    return null;
  }

  if (baseUrl.protocol !== 'https:'
    || !isQuanttHostname(baseUrl.hostname)
    || baseUrl.username
    || baseUrl.password
    || baseUrl.search
    || baseUrl.hash) return null;

  const requestedHeader = env.QUANTT_API_AUTH_HEADER?.trim().toLowerCase();
  let authHeader: QuanttAuthHeader;
  if (requestedHeader === 'x-partner-key') authHeader = 'X-Partner-Key';
  else if (requestedHeader === 'x-api-key') authHeader = 'X-API-Key';
  else if (requestedHeader === 'authorization') authHeader = 'Authorization';
  else return null;

  // Use the partner-confirmed path; do not infer an endpoint from a hostname.
  const insightsPath = env.QUANTT_INSIGHTS_PATH?.trim();
  if (!insightsPath) return null;
  if (insightsPath !== '/v1/partner/market/snapshot') return null;

  const requestedTimeout = Number(env.QUANTT_API_TIMEOUT_MS ?? 10_000);
  const timeoutMs = Number.isFinite(requestedTimeout)
    ? Math.min(30_000, Math.max(1_000, Math.trunc(requestedTimeout)))
    : 10_000;

  return { baseUrl, apiKey, authHeader, insightsPath, timeoutMs };
}

export function buildQuanttInsightsUrl(config: QuanttConfig, symbol: string): URL {
  const url = new URL(config.insightsPath, config.baseUrl);
  if (url.protocol !== 'https:' || !isQuanttHostname(url.hostname)) {
    throw new Error('Invalid Quantt upstream URL');
  }
  url.searchParams.set('symbol', symbol);
  return url;
}

export function quanttAuthHeaders(config: QuanttConfig): Record<string, string> {
  return config.authHeader === 'X-Partner-Key'
    ? { 'X-Partner-Key': config.apiKey, Accept: 'application/json' }
    : config.authHeader === 'X-API-Key'
    ? { 'X-API-Key': config.apiKey, Accept: 'application/json' }
    : { Authorization: `Bearer ${config.apiKey}`, Accept: 'application/json' };
}

export interface QuanttSnapshot {
  symbol: string;
  as_of: string;
  price: number;
  change_pct_24h: number | null;
  volume_24h: number | null;
  realized_volatility: number | null;
  metadata: { source: string | null };
}

/** Only documented snapshot fields cross the public API boundary. */
export function parseQuanttSnapshot(value: unknown, symbol: string): QuanttSnapshot | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const data = value as Record<string, unknown>;
  const finite = (v: unknown): number | null => typeof v === 'number' && Number.isFinite(v) ? v : null;
  if (data.symbol !== symbol || typeof data.as_of !== 'string' || !Number.isFinite(Date.parse(data.as_of)) ||
      finite(data.price) === null || (data.price as number) <= 0) return null;
  const metadata = data.metadata && typeof data.metadata === 'object' ? data.metadata as Record<string, unknown> : {};
  return {
    symbol, as_of: data.as_of, price: data.price as number,
    change_pct_24h: finite(data.change_pct_24h), volume_24h: finite(data.volume_24h),
    realized_volatility: finite(data.realized_volatility),
    metadata: { source: typeof metadata.source === 'string' ? metadata.source.slice(0, 80) : null },
  };
}
