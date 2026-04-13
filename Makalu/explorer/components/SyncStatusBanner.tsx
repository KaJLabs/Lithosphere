import { formatNumber, formatTimestamp } from '@/lib/format';
import type { StatsSummary } from '@/lib/types';

interface SyncStatusBannerProps {
  stats?: StatsSummary | null;
  className?: string;
}

export default function SyncStatusBanner({ stats, className = '' }: SyncStatusBannerProps) {
  if (!stats || (!stats.isSyncing && stats.inconsistentBlocks === 0)) return null;

  const latestTxLabel = stats.latestTransactionHeight > 0
    ? `#${formatNumber(stats.latestTransactionHeight)}`
    : 'Waiting for indexed txs';
  const latestTxTime = stats.latestTransactionTimestamp
    ? formatTimestamp(stats.latestTransactionTimestamp)
    : 'Not indexed yet';
  const latestBlockTime = stats.latestBlockTimestamp
    ? formatTimestamp(stats.latestBlockTimestamp)
    : 'Not indexed yet';

  return (
    <div className={`rounded-3xl border border-amber-300/15 bg-amber-300/8 p-5 text-white ${className}`.trim()}>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="max-w-3xl">
          <div className="text-xs font-medium uppercase tracking-[0.2em] text-amber-200/75">
            Explorer Sync
          </div>
          <h2 className="mt-2 text-xl font-semibold">
            {stats.inconsistentBlocks > 0
              ? 'Makalu explorer is repairing and catching up.'
              : 'Makalu explorer is still indexing the chain.'}
          </h2>
          <p className="mt-2 text-sm leading-6 text-white/70">
            Indexed block #{formatNumber(stats.tipHeight)} of chain #{formatNumber(stats.chainTipHeight)}.
            {' '}Latest indexed transaction: {latestTxLabel}. Until catch-up finishes, the Blocks view can legitimately
            be ahead of the Transactions view because many recent indexed blocks may contain zero transactions.
          </p>
          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-xs text-white/55">
            <span>Latest indexed block time: {latestBlockTime}</span>
            <span>Latest indexed tx time: {latestTxTime}</span>
            {stats.inconsistentBlocks > 0 && (
              <span>Consistency repairs queued: {formatNumber(stats.inconsistentBlocks)}</span>
            )}
          </div>
        </div>

        <div className="grid min-w-[220px] gap-3 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
          <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
            <div className="text-[11px] uppercase tracking-wide text-white/45">Lag</div>
            <div className="mt-1 text-lg font-semibold text-amber-200">
              {formatNumber(stats.syncLagBlocks)}
            </div>
          </div>
          <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
            <div className="text-[11px] uppercase tracking-wide text-white/45">Indexed Block</div>
            <div className="mt-1 text-lg font-semibold">#{formatNumber(stats.tipHeight)}</div>
          </div>
          <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
            <div className="text-[11px] uppercase tracking-wide text-white/45">Latest Tx</div>
            <div className="mt-1 text-lg font-semibold">{latestTxLabel}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
