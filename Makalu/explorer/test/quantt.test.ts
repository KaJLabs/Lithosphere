import { describe, expect, it } from 'vitest';
import { normalizeQuanttInsight, normalizeQuanttSnapshot } from '@/lib/quantt';

describe('Quantt response normalization', () => {
  it('normalizes a direct response', () => {
    expect(normalizeQuanttInsight({
      summary: 'Momentum is improving.',
      signal: 'bullish',
      confidence: '0.82',
      updated_at: '2026-07-22T00:00:00Z',
    })).toMatchObject({
      summary: 'Momentum is improving.',
      signal: 'bullish',
      score: 0.82,
      updatedAt: '2026-07-22T00:00:00Z',
    });
  });

  it('supports nested provider results and rejects non-numeric scores', () => {
    expect(normalizeQuanttInsight({ result: { analysis: 'Neutral.', sentiment: 'neutral', score: 'unknown' } })).toMatchObject({
      summary: 'Neutral.',
      signal: 'neutral',
      score: null,
    });
  });
});

describe('QUANTTS partner snapshots', () => {
  it('reads the partner fields without inventing an AI signal or score', () => {
    expect(normalizeQuanttSnapshot({ symbol: 'BTC', as_of: '2026-10-13T00:00:00Z', price: 82937.68, change_pct_24h: -0.59, volume_24h: 1013347548.6, metadata: { source: 'binance' } })).toMatchObject({ symbol: 'BTC', price: 82937.68, change_pct_24h: -0.59 });
    expect(normalizeQuanttSnapshot({ detail: 'unknown symbol: LITHO' })).toBeNull();
  });
});
