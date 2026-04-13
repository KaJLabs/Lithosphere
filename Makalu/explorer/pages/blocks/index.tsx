import { useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useApi } from '@/lib/api';
import { EXPLORER_TITLE, POLL_INTERVAL } from '@/lib/constants';
import { formatNumber, truncateHash, timeAgo } from '@/lib/format';
import type { ApiBlock, StatsSummary } from '@/lib/types';
import SyncStatusBanner from '@/components/SyncStatusBanner';

const ROWS_PER_PAGE = 25;

export default function BlocksPage() {
  const [page, setPage] = useState(1);
  const offset = (page - 1) * ROWS_PER_PAGE;

  const { data: blocks, loading, error } = useApi<ApiBlock[]>(
    `/blocks?limit=${ROWS_PER_PAGE}&offset=${offset}`,
    { pollInterval: POLL_INTERVAL },
  );

  const { data: stats } = useApi<StatsSummary>(
    '/stats/summary',
    { pollInterval: POLL_INTERVAL },
  );

  const tipHeight = stats?.tipHeight ?? 0;
  const isSyncing = Boolean(stats?.isSyncing);
  const totalPages = Math.max(1, Math.ceil(tipHeight / ROWS_PER_PAGE));

  // Client-side pagination over the fetched 25 blocks
  const rows = blocks ?? [];

  return (
    <>
      <Head>
        <title>Blocks | {EXPLORER_TITLE}</title>
      </Head>

      <SyncStatusBanner stats={stats} className="mb-6" />

      <div className="rounded-3xl border border-white/10 bg-white/5 overflow-hidden">
        {/* ── Header ──────────────────────────────────────────────── */}
        <div className="px-6 py-5 border-b border-white/10">
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-semibold text-white">Blocks</h1>
            {/* Live indicator */}
            <span className="relative flex h-2.5 w-2.5">
              <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${isSyncing ? 'bg-amber-400' : 'bg-emerald-400'}`} />
              <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${isSyncing ? 'bg-amber-500' : 'bg-emerald-500'}`} />
            </span>
            <span className={`text-xs font-medium uppercase tracking-wide ${isSyncing ? 'text-amber-300' : 'text-emerald-400'}`}>
              {isSyncing ? 'Syncing' : 'Live'}
            </span>
          </div>
          {tipHeight > 0 && (
            <p className="text-sm text-white/40 mt-1">
              Total of {formatNumber(tipHeight)} indexed blocks
            </p>
          )}
        </div>

        {/* ── Table ───────────────────────────────────────────────── */}
        {/* Desktop header */}
        <div className="hidden md:grid grid-cols-[1fr_2fr_0.6fr_0.8fr_0.8fr] px-6 py-3 border-b border-white/10">
          <span className="text-xs font-medium text-white/40 uppercase tracking-wide">Block</span>
          <span className="text-xs font-medium text-white/40 uppercase tracking-wide">Hash</span>
          <span className="text-xs font-medium text-white/40 uppercase tracking-wide">Txns</span>
          <span className="text-xs font-medium text-white/40 uppercase tracking-wide">Gas Used</span>
          <span className="text-xs font-medium text-white/40 uppercase tracking-wide text-right">Time</span>
        </div>

        {/* Error state */}
        {error && !loading && (
          <div className="px-6 py-16 text-center">
            <p className="text-white/60 text-sm">Failed to load blocks</p>
            <p className="text-white/30 text-xs mt-1">{error}</p>
          </div>
        )}

        {/* Loading skeleton */}
        {loading && rows.length === 0 && (
          <>
            {Array.from({ length: ROWS_PER_PAGE }).map((_, i) => (
              <div
                key={i}
                className="grid grid-cols-1 md:grid-cols-[1fr_2fr_0.6fr_0.8fr_0.8fr] gap-2 md:gap-0 px-6 py-4 border-b border-white/5"
              >
                <div className="h-4 w-20 bg-white/10 rounded animate-pulse" />
                <div className="h-4 w-48 bg-white/10 rounded animate-pulse hidden md:block" />
                <div className="h-4 w-8 bg-white/10 rounded animate-pulse hidden md:block" />
                <div className="h-4 w-16 bg-white/10 rounded animate-pulse hidden md:block" />
                <div className="h-4 w-14 bg-white/10 rounded animate-pulse ml-auto hidden md:block" />
              </div>
            ))}
          </>
        )}

        {/* Empty state */}
        {!loading && !error && rows.length === 0 && (
          <div className="px-6 py-16 text-center">
            <p className="text-white/40 text-sm">No blocks found</p>
          </div>
        )}

        {/* Data rows */}
        {rows.map((block) => (
          <Link
            key={block.height}
            href={`/blocks/${block.height}`}
            className="block border-b border-white/5 hover:bg-white/[0.03] transition"
          >
            {/* Desktop row */}
            <div className="hidden md:grid grid-cols-[1fr_2fr_0.6fr_0.8fr_0.8fr] px-6 py-4 items-center">
              <span className="font-mono font-medium text-emerald-300 hover:text-emerald-200">
                {formatNumber(block.height)}
              </span>
              <span className="font-mono text-sm text-white/60 truncate">
                {truncateHash(block.hash, 16, 8)}
              </span>
              <span className="text-sm text-white/80">
                {formatNumber(block.txCount)}
              </span>
              <span className="text-sm text-white/60">
                {block.gasUsed ? formatNumber(block.gasUsed) : '-'}
              </span>
              <span className="text-sm text-white/40 text-right">
                {timeAgo(block.timestamp)}
              </span>
            </div>

            {/* Mobile row */}
            <div className="md:hidden px-6 py-4 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-white/40">Block</span>
                  <span className="font-mono font-medium text-emerald-300">
                    {formatNumber(block.height)}
                  </span>
                </div>
                <span className="text-xs text-white/40">{timeAgo(block.timestamp)}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-white/40">Hash</span>
                <span className="font-mono text-xs text-white/60 truncate">
                  {truncateHash(block.hash, 12, 6)}
                </span>
              </div>
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-white/40">Txns</span>
                  <span className="text-xs text-white/80">{formatNumber(block.txCount)}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-white/40">Gas</span>
                  <span className="text-xs text-white/60">
                    {block.gasUsed ? formatNumber(block.gasUsed) : '-'}
                  </span>
                </div>
              </div>
            </div>
          </Link>
        ))}

        {/* ── Pagination ─────────────────────────────────────────── */}
        {rows.length > 0 && (
          <div className="flex items-center justify-between px-6 py-4">
            <span className="text-sm text-white/40">
              Page {page} of {formatNumber(totalPages)}
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="px-4 py-2 text-sm font-medium rounded-lg border border-white/10 text-white/60
                           hover:bg-white/5 hover:text-white transition
                           disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent"
              >
                Previous
              </button>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="px-4 py-2 text-sm font-medium rounded-lg border border-white/10 text-white/60
                           hover:bg-white/5 hover:text-white transition
                           disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent"
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
