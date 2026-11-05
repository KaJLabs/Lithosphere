export interface QuanttStatus {
  ok: boolean;
  configured: boolean;
  researchUrl: string;
  developerUrl: string;
  apiOrigin: string | null;
}

export interface QuanttInsightResponse {
  ok: boolean;
  provider: 'quantt';
  symbol: string;
  data: unknown;
}

export interface QuanttInsight {
  summary: string | null;
  signal: string | null;
  score: number | null;
  updatedAt: string | null;
  raw: unknown;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function firstString(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

export function normalizeQuanttInsight(value: unknown): QuanttInsight {
  const root = asRecord(value) ?? {};
  const nested = asRecord(root.insight) ?? asRecord(root.result) ?? root;
  const rawScore = nested.score ?? nested.confidence ?? nested.probability;
  const parsedScore = typeof rawScore === 'number'
    ? rawScore
    : (typeof rawScore === 'string' && rawScore.trim() ? Number(rawScore) : NaN);

  return {
    summary: firstString(nested, ['summary', 'analysis', 'description', 'message']),
    signal: firstString(nested, ['signal', 'sentiment', 'recommendation', 'direction']),
    score: Number.isFinite(parsedScore) ? parsedScore : null,
    updatedAt: firstString(nested, ['updatedAt', 'updated_at', 'timestamp', 'createdAt']),
    raw: value,
  };
}

export interface QuanttSnapshot {
  symbol: string;
  as_of: string;
  price: number;
  change_pct_24h: number | null;
  volume_24h: number | null;
  metadata: { source: string | null };
}
export function normalizeQuanttSnapshot(value: unknown): QuanttSnapshot | null {
  const data = asRecord(value);
  if (!data || typeof data.symbol !== 'string' || typeof data.as_of !== 'string' ||
      !Number.isFinite(Date.parse(data.as_of)) || typeof data.price !== 'number' || !Number.isFinite(data.price) || data.price <= 0) return null;
  const number = (v: unknown) => typeof v === 'number' && Number.isFinite(v) ? v : null;
  return { symbol: data.symbol, as_of: data.as_of, price: data.price,
    change_pct_24h: number(data.change_pct_24h), volume_24h: number(data.volume_24h),
    metadata: { source: typeof asRecord(data.metadata)?.source === 'string' ? asRecord(data.metadata)!.source as string : null },
  };
}
