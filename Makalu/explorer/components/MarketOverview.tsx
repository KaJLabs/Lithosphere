import { useApi } from '@/lib/api';
import { formatValue } from '@/lib/format';

interface MarketSummary {
  market: {
    price: string | null;
    currency: string;
    source: string | null;
    kind: string | null;
    changePercent24h: number | null;
    updatedAt: string | null;
    tradeUrl: string;
  } | null;
  totalSupply: string | null;
  bondedTokens: string | null;
  transactionsPerSecond: string | null;
}

/** Multiply base-unit supply by a decimal quote without rounding either through Number. */
export function supplyValuation(supply: string, price: string): string {
  const [whole, fraction = ''] = price.split('.');
  const cents = BigInt(supply) * BigInt(whole + fraction) * BigInt(100) /
    (BigInt(10) ** BigInt(18 + fraction.length));
  return `${(cents / BigInt(100)).toLocaleString('en-US')}.${(cents % BigInt(100)).toString().padStart(2, '0')}`;
}

// Project-supplied circulation until an authoritative circulating-supply feed is available.
const CIRCULATING_SUPPLY = '60000000000000000000000000';

export default function MarketOverview() {
  const { data, loading, error } = useApi<MarketSummary>('/market-summary', { pollInterval: 60_000 });
  const market = error ? null : data?.market;
  const unavailable = loading ? 'Loading…' : 'Unavailable';
  const price = market?.price;
  const supply = error ? null : data?.totalSupply;
  const items = [
    {
      label: market?.kind === 'launch price' ? 'LITHO launch price' : 'LITHO price',
      value: price ? `$${/^\d+(?:\.\d{1,2})?$/.test(price) ? Number(price).toFixed(2) : price} USD` : unavailable,
      detail: price ? market.kind === 'launch price' ? 'Ignite DEX · Fixed launch price; open-market trading has not started' : `${market.source} · ${market.kind}` : 'Waiting for a fresh Ignite or Magma quote',
    },
    {
      label: 'Fully diluted valuation (FDV)',
      value: price && supply ? `$${supplyValuation(supply, price).split('.')[0]} USD` : unavailable,
      detail: supply ? 'Based on total on-chain supply' : 'Total on-chain supply unavailable',
    },
    {
      label: 'Circulation',
      value: '60,000,000',
      detail: 'LITHO · Project-reported circulating supply',
    },
    {
      label: 'Current market cap',
      value: price ? `$${supplyValuation(CIRCULATING_SUPPLY, price).split('.')[0]} USD` : unavailable,
      detail: 'Circulating supply × current price',
    },
    {
      label: 'Voting power',
      value: !error && data?.bondedTokens != null ? formatValue(data.bondedTokens) : unavailable,
      detail: 'Bonded, non-jailed validators',
    },
    {
      label: 'Transactions per second (TPS)',
      value: !error && data?.transactionsPerSecond != null ? `${Number(data.transactionsPerSecond).toFixed(2)} TPS` : unavailable,
      detail: 'Indexed transactions over the last 60 seconds',
    },
  ];
  return (
    <section aria-label="LITHO market overview" className="card mt-6 overflow-hidden">
      <div className="grid divide-y divide-[var(--color-border)] sm:grid-cols-2 sm:divide-y-0">
        {items.map((item) => <div key={item.label} className="min-w-0 border-b border-[var(--color-border)] p-5">
          <div className="text-xs uppercase tracking-wider text-[var(--color-text-muted)]">{item.label}</div>
          <div className="mt-2 break-words text-xl font-semibold [overflow-wrap:anywhere]">{item.value}</div>
          <div className="mt-2 text-xs text-[var(--color-text-secondary)]">{item.detail}</div>
        </div>)}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-xs text-[var(--color-text-secondary)]">
        <span>{price && market.updatedAt ? `Quote checked ${new Date(market.updatedAt).toLocaleString()}` : 'Market data refreshes every minute'}
          {price && market.changePercent24h != null && <span className={market.changePercent24h < 0 ? 'ml-2 text-red-500' : 'ml-2 text-emerald-500'}>{market.changePercent24h > 0 ? '+' : ''}{market.changePercent24h.toFixed(2)}% (24h)</span>}
        </span>
        <a href="https://ignite.trade" target="_blank" rel="noopener noreferrer" className="font-medium text-litho-400 hover:underline">Trade on Ignite DEX ↗</a>
      </div>
    </section>
  );
}
