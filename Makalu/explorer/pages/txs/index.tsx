import { useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useApi } from '@/lib/api';
import { EXPLORER_TITLE, POLL_INTERVAL } from '@/lib/constants';
import { truncateHash, formatNumber, timeAgo, formatValue } from '@/lib/format';
import type { ApiTxList, StatsSummary } from '@/lib/types';
import { FormattedValueElement } from '@/components/FormattedValueElement';
import SyncStatusBanner from '@/components/SyncStatusBanner';

const PAGE_SIZE = 25;

function StatusDot({ success }: { success: boolean }) {
  return (
    <span
      className={`inline-flex h-2 w-2 rounded-full ${success ? 'bg-emerald-400' : 'bg-red-400'}`}
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
    if (h) router.push(`/txs/${h}`);
  };

  return (
    <>
      <Head>
        <title>Transactions | {EXPLORER_TITLE}</title>
        <meta name="description" content="Browse all transactions on the Makalu testnet." />
      </Head>

      <div className="text-white">
        {/* Header */}
        <div className="mb-6">
          <div className="text-sm text-white/55 mb-1">
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

        {/* Search */}
        <form onSubmit={handleSearch} className="mb-6 flex gap-3">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by transaction hash…"
            className="flex-1 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white placeholder-white/35 focus:border-emerald-400/50 focus:outline-none focus:ring-1 focus:ring-emerald-400/30"
          />
          <button
            type="submit"
            className="rounded-2xl bg-white px-5 py-3 text-sm font-medium text-black hover:bg-white/90 transition"
          >
            Search
          </button>
        </form>

        {/* Transaction list */}
        <div className="rounded-3xl border border-white/10 bg-white/5 overflow-hidden">
          {/* Table header */}
          <div className="hidden md:grid grid-cols-[1.8fr_1fr_1.4fr_1.4fr_1fr_0.7fr_0.8fr] gap-4 px-5 py-3 border-b border-white/10 text-xs font-medium text-white/40 uppercase tracking-wide">
            <div>Tx Hash</div>
            <div>Block</div>
            <div>From</div>
            <div>To</div>
            <div>Value</div>
            <div>Method</div>
            <div>Age</div>
          </div>

          {loading && txs.length === 0 ? (
            <div className="space-y-0">
              {Array.from({ length: PAGE_SIZE }).map((_, i) => (
                <div
                  key={i}
                  className="grid grid-cols-[1fr_1fr] md:grid-cols-[1.8fr_1fr_1.4fr_1.4fr_1fr_0.7fr_0.8fr] gap-4 px-5 py-4 border-b border-white/5 animate-pulse"
                >
                  <div className="h-4 rounded bg-white/10 w-3/4" />
                  <div className="h-4 rounded bg-white/10 w-1/2" />
                  <div className="hidden md:block h-4 rounded bg-white/10 w-2/3" />
                  <div className="hidden md:block h-4 rounded bg-white/10 w-2/3" />
                  <div className="hidden md:block h-4 rounded bg-white/10 w-1/2" />
                  <div className="hidden md:block h-4 rounded bg-white/10 w-1/3" />
                  <div className="hidden md:block h-4 rounded bg-white/10 w-1/2" />
                </div>
              ))}
            </div>
          ) : txs.length === 0 ? (
            <div className="py-20 text-center text-white/40">
              <div className="text-lg font-medium mb-2">No transactions yet</div>
              <div className="text-sm">
                {isSyncing
                  ? 'Transactions will appear here as the explorer catches up to the chain.'
                  : 'Transactions will appear here as they are indexed from the chain.'}
              </div>
            </div>
          ) : (
            <div>
              {txs.map((tx) => (
                <div
                  key={tx.hash}
                  className="grid grid-cols-1 md:grid-cols-[1.8fr_1fr_1.4fr_1.4fr_1fr_0.7fr_0.8fr] gap-3 md:gap-4 px-5 py-4 border-b border-white/5 hover:bg-white/[0.03] transition"
                >
                  {/* Hash */}
                  <div className="flex items-center gap-2">
                    <StatusDot success={tx.success} />
                    <Link
                      href={`/txs/${tx.hash || tx.evmHash}`}
                      className="font-mono text-sm text-emerald-300 hover:text-emerald-200 transition truncate"
                    >
                      {truncateHash(tx.hash || tx.evmHash || '')}
                    </Link>
                  </div>

                  {/* Block */}
                  <div className="flex items-center md:block">
                    <span className="md:hidden text-xs text-white/40 mr-2 w-16 shrink-0">Block</span>
                    <Link
                      href={`/blocks/${tx.blockHeight}`}
                      className="font-mono text-sm text-white/80 hover:text-white transition"
                    >
                      #{formatNumber(tx.blockHeight)}
                    </Link>
                  </div>

                  {/* From */}
                  <div className="flex items-center md:block">
                    <span className="md:hidden text-xs text-white/40 mr-2 w-16 shrink-0">From</span>
                    <Link
                      href={`/address/${tx.fromAddr}`}
                      className="font-mono text-sm text-white/70 hover:text-white transition truncate"
                    >
                      {truncateHash(tx.fromAddr, 10, 6)}
                    </Link>
                  </div>

                  {/* To */}
                  <div className="flex items-center md:block">
                    <span className="md:hidden text-xs text-white/40 mr-2 w-16 shrink-0">To</span>
                    {tx.toAddr ? (
                      <Link
                        href={`/address/${tx.toAddr}`}
                        className="font-mono text-sm text-white/70 hover:text-white transition truncate"
                      >
                        {truncateHash(tx.toAddr, 10, 6)}
                      </Link>
                    ) : (
                      <span className="text-sm text-white/30">&mdash;</span>
                    )}
                  </div>

                  {/* Value */}
                  <div className="flex items-center md:block">
                    <span className="md:hidden text-xs text-white/40 mr-2 w-16 shrink-0">Value</span>
                    <span className="text-sm text-white/80">
                      <FormattedValueElement 
                        formattedStr={formatValue(tx.value, tx.denom)}
                        tokenAddress={tx.contractAddress}
                      />
                    </span>
                  </div>

                  {/* Method */}
                  <div className="flex items-center md:block">
                    <span className="md:hidden text-xs text-white/40 mr-2 w-16 shrink-0">Method</span>
                    <span className="inline-flex items-center rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-xs font-medium text-white/70 truncate max-w-[120px]" title={tx.methodName ?? tx.txType ?? 'Transfer'}>
                      {tx.methodName ?? (tx.txType === 'call' ? 'Call' : tx.txType === 'create' ? 'Create' : 'Transfer')}
                    </span>
                  </div>

                  {/* Age */}
                  <div className="flex items-center md:block">
                    <span className="md:hidden text-xs text-white/40 mr-2 w-16 shrink-0">Age</span>
                    <span className="text-sm text-white/50">
                      {tx.timestamp ? timeAgo(tx.timestamp) : '—'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="mt-4 flex items-center justify-between">
            <div className="text-sm text-white/40">
              Page {page + 1} of {formatNumber(totalPages)}
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
                className="rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/70 hover:bg-white/10 transition disabled:opacity-30 disabled:cursor-not-allowed"
              >
                Previous
              </button>
              <button
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                disabled={page >= totalPages - 1}
                className="rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/70 hover:bg-white/10 transition disabled:opacity-30 disabled:cursor-not-allowed"
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
