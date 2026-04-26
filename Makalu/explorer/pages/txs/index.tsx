import { useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useApi } from '@/lib/api';
import { EXPLORER_TITLE, POLL_INTERVAL } from '@/lib/constants';
import { truncateHash, formatNumber, timeAgo, formatTimestamp, formatValue, formatSupply } from '@/lib/format';
import { getPreferredTxHash, normalizeEvmTxHash } from '@/lib/tx';
import type { ApiTxList, StatsSummary } from '@/lib/types';
import { FormattedValueElement } from '@/components/FormattedValueElement';
import SyncStatusBanner from '@/components/SyncStatusBanner';

const PAGE_SIZE = 25;
const TX_TABLE_GRID_CLASS = 'lg:grid-cols-[minmax(0,1.8fr)_minmax(0,1fr)_minmax(0,1.4fr)_minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,0.7fr)_minmax(0,0.8fr)]';

function StatusDot({ success }: { success: boolean }) {
  return (
    <span
      className={`inline-flex h-2 w-2 shrink-0 rounded-full ${success ? 'bg-emerald-400' : 'bg-red-400'}`}
      title={success ? 'Success' : 'Failed'}
    />
  );
}

export default function TransactionsPage() {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);

  const offset = page * PAGE_SIZE;
  const { data, loading } = useApi<ApiTxList>(
    `/txs?limit=${PAGE_SIZE}&offset=${offset}`,
    { pollInterval: POLL_INTERVAL }
  );
  const { data: stats } = useApi<StatsSummary>(
    '/stats/summary',
    { pollInterval: POLL_INTERVAL }
  );

  const txs = data?.txs ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);
  const isSyncing = Boolean(stats?.isSyncing);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const h = search.trim();
    const normalizedHash = normalizeEvmTxHash(h) ?? h;
    if (normalizedHash) router.push(`/txs/${normalizedHash}`);
  };

  return (
    <>
      <Head>
        <title>Transactions | {EXPLORER_TITLE}</title>
        <meta name="description" content="Browse all transactions on the Makalu testnet." />
      </Head>

      <div className="text-white">
        <div className="mb-6">
          <div className="mb-1 text-sm text-white/55">
            {isSyncing ? 'Indexed Feed' : 'Realtime Feed'}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <h1 className="text-3xl font-semibold">Transactions</h1>
            {total > 0 && (
              <div className="text-sm text-white/55">
                {formatNumber(total)} total transactions
              </div>
            )}
          </div>
        </div>

        <SyncStatusBanner stats={stats} className="mb-6" />

        <form onSubmit={handleSearch} className="mb-6 flex gap-3">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by transaction hash..."
            className="flex-1 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white placeholder-white/35 focus:border-emerald-400/50 focus:outline-none focus:ring-1 focus:ring-emerald-400/30"
          />
          <button
            type="submit"
            className="rounded-2xl bg-white px-5 py-3 text-sm font-medium text-black transition hover:bg-white/90"
          >
            Search
          </button>
        </form>

        <div className="overflow-hidden rounded-3xl border border-white/10 bg-white/5">
          <div className="overflow-x-auto">
            <div className="min-w-0">
              <div className={`hidden lg:grid ${TX_TABLE_GRID_CLASS} gap-4 border-b border-white/10 px-5 py-3 text-[11px] font-medium uppercase tracking-[0.24em] text-white/40`}>
                <div>Tx Hash</div>
                <div>Block</div>
                <div>From</div>
                <div>To</div>
                <div>Value</div>
                <div>Method</div>
                <div className="text-right">Age</div>
              </div>

              {loading && txs.length === 0 ? (
                <div className="space-y-0">
                  {Array.from({ length: PAGE_SIZE }).map((_, i) => (
                    <div
                      key={i}
                      className={`grid grid-cols-1 ${TX_TABLE_GRID_CLASS} gap-3 border-b border-white/5 px-5 py-4 animate-pulse lg:gap-4`}
                    >
                      <div className="h-4 w-3/4 rounded bg-white/10" />
                      <div className="h-4 w-1/2 rounded bg-white/10" />
                      <div className="h-4 w-2/3 rounded bg-white/10" />
                      <div className="h-4 w-2/3 rounded bg-white/10" />
                      <div className="h-4 w-1/2 rounded bg-white/10" />
                      <div className="h-4 w-1/3 rounded bg-white/10" />
                      <div className="h-4 w-1/2 rounded bg-white/10 lg:justify-self-end" />
                    </div>
                  ))}
                </div>
              ) : txs.length === 0 ? (
                <div className="py-20 text-center text-white/40">
                  <div className="mb-2 text-lg font-medium">No transactions yet</div>
                  <div className="text-sm">
                    {isSyncing
                      ? 'Transactions will appear here as the explorer catches up to the chain.'
                      : 'Transactions will appear here as they are indexed from the chain.'}
                  </div>
                </div>
              ) : (
                <div>
                  {txs.map((tx) => {
                    const methodLabel = tx.methodName ?? (tx.txType === 'call' ? 'Call' : tx.txType === 'create' ? 'Create' : 'Transfer');
                    const txHash = getPreferredTxHash(tx);
                    const txKey = txHash ?? `${tx.blockHeight}-${tx.fromAddr}-${tx.toAddr ?? 'none'}-${tx.timestamp ?? 'unknown'}`;
                    return (
                      <div
                        key={txKey}
                        className={`grid grid-cols-1 ${TX_TABLE_GRID_CLASS} gap-3 border-b border-white/5 px-5 py-4 transition hover:bg-white/[0.03] lg:gap-4`}
                      >
                        <div className="flex min-w-0 items-center gap-2">
                          <StatusDot success={tx.success} />
                          {txHash ? (
                            <Link
                              href={`/txs/${txHash}`}
                              className="block truncate font-mono text-sm text-emerald-300 transition hover:text-emerald-200"
                              title={txHash}
                            >
                              {truncateHash(txHash)}
                            </Link>
                          ) : (
                            <span className="block truncate font-mono text-sm text-white/30" title="Transaction hash unavailable">
                              Unavailable
                            </span>
                          )}
                        </div>

                        <div className="flex min-w-0 items-center lg:block">
                          <span className="mr-2 w-16 shrink-0 text-xs text-white/40 lg:hidden">Block</span>
                          <Link
                            href={`/blocks/${tx.blockHeight}`}
                            className="font-mono text-sm text-white/80 transition hover:text-white"
                          >
                            #{formatNumber(tx.blockHeight)}
                          </Link>
                        </div>

                        <div className="flex min-w-0 items-center lg:block">
                          <span className="mr-2 w-16 shrink-0 text-xs text-white/40 lg:hidden">From</span>
                          <Link
                            href={`/address/${tx.fromAddr}`}
                            className="block truncate font-mono text-sm text-white/70 transition hover:text-white"
                            title={tx.fromAddr}
                          >
                            {truncateHash(tx.fromAddr, 10, 6)}
                          </Link>
                        </div>

                        <div className="flex min-w-0 items-center lg:block">
                          <span className="mr-2 w-16 shrink-0 text-xs text-white/40 lg:hidden">To</span>
                          {tx.toAddr ? (
                            <Link
                              href={`/address/${tx.toAddr}`}
                              className="block truncate font-mono text-sm text-white/70 transition hover:text-white"
                              title={tx.toAddr}
                            >
                              {truncateHash(tx.toAddr, 10, 6)}
                            </Link>
                          ) : (
                            <span className="text-sm text-white/30">--</span>
                          )}
                        </div>

                        <div className="flex min-w-0 items-start lg:block">
                          <span className="mr-2 w-16 shrink-0 text-xs text-white/40 lg:hidden">Value</span>
                          <span className="block min-w-0 text-sm text-white/80">
                            {tx.tokenTransferAmount ? (
                              <FormattedValueElement
                                formattedStr={tx.tokenSymbol
                                  ? `${formatSupply(tx.tokenTransferAmount)} ${tx.tokenSymbol}`
                                  : formatSupply(tx.tokenTransferAmount)}
                                tokenAddress={tx.contractAddress}
                              />
                            ) : (
                              <FormattedValueElement
                                formattedStr={formatValue(tx.value, tx.denom)}
                                tokenAddress={tx.contractAddress}
                              />
                            )}
                          </span>
                        </div>

                        <div className="flex min-w-0 items-center lg:block">
                          <span className="mr-2 w-16 shrink-0 text-xs text-white/40 lg:hidden">Method</span>
                          <span
                            className="inline-flex max-w-full items-center rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] font-medium text-white/70"
                            title={methodLabel}
                          >
                            <span className="truncate">{methodLabel}</span>
                          </span>
                        </div>

                        <div className="flex min-w-0 items-center lg:block lg:text-right">
                          <span className="mr-2 w-16 shrink-0 text-xs text-white/40 lg:hidden">Age</span>
                          <span className="text-sm text-white/50" title={formatTimestamp(tx.timestamp)}>
                            {tx.timestamp ? timeAgo(tx.timestamp) : '--'}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>

        {totalPages > 1 && (
          <div className="mt-4 flex items-center justify-between">
            <div className="text-sm text-white/40">
              Page {page + 1} of {formatNumber(totalPages)}
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
                className="rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/70 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-30"
              >
                Previous
              </button>
              <button
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                disabled={page >= totalPages - 1}
                className="rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/70 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-30"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
