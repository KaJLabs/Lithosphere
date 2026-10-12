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

export default function MarketOverview() {
  const { data, loading, error } = useApi<MarketSummary>('/market-summary', { pollInterval: 60_000 });
  const market = error ? null : data?.market;
  const unavailable = loading ? 'Loading…' : 'Unavailable';
  const price = market?.price;
  const supply = error ? null : data?.totalSupply;
  const items = [
    {
      label: 'LITHO price',
      value: price ? `${price} ${market.currency}` : unavailable,
      detail: price ? `${market.source} · ${market.kind}` : 'Waiting for a fresh Ignite or Magma quote',
    },
    {
      label: 'Market cap (total supply)',
      value: price && supply ? `${supplyValuation(supply, price)} ${market.currency}` : unavailable,
      detail: supply ? `${formatValue(supply)} total on-chain supply; not circulating supply` : 'Total on-chain supply unavailable',
    },
    {
      label: 'Voting power',
      value: !error && data?.bondedTokens != null ? formatValue(data.bondedTokens) : unavailable,
      detail: 'Bonded, non-jailed validators',
    },
    {
      label: 'Transactions per second',
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
