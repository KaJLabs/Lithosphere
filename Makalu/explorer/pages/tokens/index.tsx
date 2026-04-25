import { useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useApi } from '@/lib/api';
import { EXPLORER_TITLE } from '@/lib/constants';
import { formatNumber, formatSupply, truncateHash } from '@/lib/format';
import type { ApiToken } from '@/lib/types';

const AVATAR_COLORS = [
  'bg-emerald-500',
  'bg-violet-500',
  'bg-amber-500',
  'bg-rose-500',
  'bg-sky-500',
  'bg-pink-500',
  'bg-teal-500',
  'bg-indigo-500',
  'bg-orange-500',
  'bg-cyan-500',
];

function getAvatarColor(symbol: string): string {
  let hash = 0;
  for (let i = 0; i < symbol.length; i++) {
    hash = symbol.charCodeAt(i) + ((hash << 5) - hash);
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

const ITEMS_PER_PAGE = 25;

function TokenTypeBadge({ type }: { type: ApiToken['type'] }) {
  if (type === 'native') {
    return (
      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-300 border border-emerald-500/20">
        native
      </span>
    );
  }
  if (type === 'ERC-721') {
    return (
      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-500/10 text-amber-300 border border-amber-500/20">
        ERC-721
      </span>
    );
  }
  return (
    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-violet-500/10 text-violet-300 border border-violet-500/20">
      LEP100
    </span>
  );
}

function SkeletonRow() {
  return (
    <tr className="border-b border-white/5">
      <td className="px-4 py-4"><div className="h-4 w-6 bg-white/10 rounded animate-pulse" /></td>
      <td className="px-4 py-4">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-white/10 animate-pulse" />
          <div className="space-y-1">
            <div className="h-4 w-16 bg-white/10 rounded animate-pulse" />
            <div className="h-3 w-24 bg-white/10 rounded animate-pulse" />
          </div>
        </div>
      </td>
      <td className="px-4 py-4"><div className="h-5 w-16 bg-white/10 rounded-full animate-pulse" /></td>
      <td className="px-4 py-4"><div className="h-4 w-24 bg-white/10 rounded animate-pulse" /></td>
      <td className="px-4 py-4"><div className="h-4 w-12 bg-white/10 rounded animate-pulse" /></td>
      <td className="px-4 py-4"><div className="h-4 w-32 bg-white/10 rounded animate-pulse" /></td>
    </tr>
  );
}

function SkeletonCard() {
  return (
    <div className="bg-white/5 rounded-2xl p-4 border border-white/10 animate-pulse">
      <div className="flex items-center gap-3 mb-3">
        <div className="w-10 h-10 rounded-full bg-white/10" />
        <div className="space-y-2">
          <div className="h-4 w-20 bg-white/10 rounded" />
          <div className="h-3 w-28 bg-white/10 rounded" />
        </div>
      </div>
      <div className="space-y-2">
        <div className="h-3 w-full bg-white/10 rounded" />
        <div className="h-3 w-2/3 bg-white/10 rounded" />
      </div>
    </div>
  );
}

export default function TokensPage() {
  const router = useRouter();
  const { data: tokens, loading, error } = useApi<ApiToken[]>('/tokens');
  const [page, setPage] = useState(1);

  const totalTokens = tokens?.length ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalTokens / ITEMS_PER_PAGE));
  const startIdx = (page - 1) * ITEMS_PER_PAGE;
  const pageTokens = tokens?.slice(startIdx, startIdx + ITEMS_PER_PAGE) ?? [];

  return (
    <>
      <Head>
        <title>Tokens | {EXPLORER_TITLE}</title>
      </Head>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-2xl sm:text-3xl font-bold text-white">Tokens</h1>
          {!loading && tokens && (
            <p className="text-sm text-white/40 mt-1">
              A total of {formatNumber(totalTokens)} token{totalTokens !== 1 ? 's' : ''} found
            </p>
          )}
        </div>

        {/* Main container */}
        <div className="bg-white/5 border border-white/10 rounded-3xl overflow-hidden">
          {/* Error state */}
          {error && (
            <div className="flex flex-col items-center justify-center py-20 px-4">
              <svg className="w-12 h-12 text-white/20 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
              </svg>
              <p className="text-white/40 text-sm">{error}</p>
            </div>
          )}

          {/* Loading state */}
          {loading && !error && (
            <>
              {/* Desktop skeleton */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-white/10">
                      <th className="px-4 py-3 text-left text-xs font-medium text-white/40 uppercase tracking-wide">#</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-white/40 uppercase tracking-wide">Token</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-white/40 uppercase tracking-wide">Type</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-white/40 uppercase tracking-wide">Total Supply</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-white/40 uppercase tracking-wide">Holders</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-white/40 uppercase tracking-wide">Address</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Array.from({ length: 8 }).map((_, i) => (
                      <SkeletonRow key={i} />
                    ))}
                  </tbody>
                </table>
              </div>
              {/* Mobile skeleton */}
              <div className="md:hidden p-4 space-y-3">
                {Array.from({ length: 6 }).map((_, i) => (
                  <SkeletonCard key={i} />
                ))}
              </div>
            </>
          )}

          {/* Empty state */}
          {!loading && !error && totalTokens === 0 && (
            <div className="flex flex-col items-center justify-center py-20 px-4">
              <svg className="w-12 h-12 text-white/20 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375m16.5 0v3.75m-16.5-3.75v3.75m16.5 0v3.75C20.25 16.153 16.556 18 12 18s-8.25-1.847-8.25-4.125v-3.75m16.5 0c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125" />
              </svg>
              <p className="text-white/40 text-sm">No tokens found</p>
            </div>
          )}

          {/* Data loaded */}
          {!loading && !error && totalTokens > 0 && (
            <>
              {/* Desktop table */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-white/10">
                      <th className="px-4 py-3 text-left text-xs font-medium text-white/40 uppercase tracking-wide w-12">#</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-white/40 uppercase tracking-wide">Token</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-white/40 uppercase tracking-wide">Type</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-white/40 uppercase tracking-wide">Total Supply</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-white/40 uppercase tracking-wide">Holders</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-white/40 uppercase tracking-wide">Address</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageTokens.map((token, idx) => {
                      const tokenHref = token.contractAddress
                        ? `/token/${token.contractAddress}`
                        : `/token/native`;

                      return (
                        <tr
                          key={token.contractAddress ?? token.symbol}
                          className="border-b border-white/5 hover:bg-white/[0.03] transition cursor-pointer"
                          onClick={() => router.push(tokenHref)}
                        >
                          {/* # */}
                          <td className="px-4 py-4 text-sm text-white/40">
                            {startIdx + idx + 1}
                          </td>

                          {/* Token (avatar + symbol + name) */}
                          <td className="px-4 py-4">
                            <Link href={tokenHref} className="flex items-center gap-3 group">
                              {token.type === 'native' ? (
                                <img src="/litho-logo.png" alt={token.symbol} className="w-8 h-8 rounded-full object-contain" />
                              ) : (
                                <div
                                  className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white ${getAvatarColor(token.symbol)}`}
                                >
                                  {token.symbol.charAt(0).toUpperCase()}
                                </div>
                              )}
                              <div>
                                <span className="text-sm font-semibold text-white group-hover:text-emerald-300 transition">
                                  {token.symbol}
                                </span>
                                <div className="text-xs text-white/40">{token.name}</div>
                              </div>
                            </Link>
                          </td>

                          {/* Type */}
                          <td className="px-4 py-4">
                            <TokenTypeBadge type={token.type} />
                          </td>

                          {/* Total Supply */}
                          <td className="px-4 py-4 text-sm text-white/70 text-right tabular-nums">
                            {token.totalSupply ? formatSupply(token.totalSupply, token.decimals) : '-'}
                          </td>

                          {/* Holders */}
                          <td className="px-4 py-4 text-sm text-white/70 text-right tabular-nums">
                            {token.holders != null ? formatNumber(token.holders) : '-'}
                          </td>

                          {/* Contract Address */}
                          <td className="px-4 py-4 text-sm">
                            {token.contractAddress ? (
                              <Link
                                href={`/address/${token.contractAddress}`}
                                className="text-emerald-300 hover:text-emerald-200 font-mono transition"
                              >
                                {truncateHash(token.contractAddress)}
                              </Link>
                            ) : (
                              <span className="text-white/30">Native</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Mobile cards */}
              <div className="md:hidden p-4 space-y-3">
                {pageTokens.map((token, idx) => {
                  const cardHref = token.contractAddress
                    ? `/token/${token.contractAddress}`
                    : `/token/native`;

                  return (
                    <Link
                      key={token.contractAddress ?? token.symbol}
                      href={cardHref}
                      className="block bg-white/[0.03] rounded-2xl p-4 border border-white/5 hover:bg-white/[0.06] transition"
                    >
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-3">
                          {token.type === 'native' ? (
                            <img src="/litho-logo.png" alt={token.symbol} className="w-10 h-10 rounded-full object-contain" />
                          ) : (
                            <div
                              className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold text-white ${getAvatarColor(token.symbol)}`}
                            >
                              {token.symbol.charAt(0).toUpperCase()}
                            </div>
                          )}
                          <div>
                            <div className="text-sm font-semibold text-white">{token.symbol}</div>
                            <div className="text-xs text-white/40">{token.name}</div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-white/30">#{startIdx + idx + 1}</span>
                          <TokenTypeBadge type={token.type} />
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-3 text-sm">
                        <div>
                          <div className="text-xs text-white/30 mb-0.5">Total Supply</div>
                          <div className="text-white/70 tabular-nums">
                            {token.totalSupply ? formatSupply(token.totalSupply, token.decimals) : '-'}
                          </div>
                        </div>
                        <div>
                          <div className="text-xs text-white/30 mb-0.5">Holders</div>
                          <div className="text-white/70 tabular-nums">
                            {token.holders != null ? formatNumber(token.holders) : '-'}
                          </div>
                        </div>
                      </div>

                      {token.contractAddress && (
                        <div className="mt-3 pt-3 border-t border-white/5">
                          <div className="text-xs text-white/30 mb-0.5">Contract</div>
                          <span className="text-emerald-300 text-sm font-mono">
                            {truncateHash(token.contractAddress, 16, 8)}
                          </span>
                        </div>
                      )}
                    </Link>
                  );
                })}
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between px-4 py-4 border-t border-white/10">
                  <p className="text-xs text-white/30">
                    Showing {startIdx + 1} to {Math.min(startIdx + ITEMS_PER_PAGE, totalTokens)} of {formatNumber(totalTokens)}
                  </p>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setPage(1)}
                      disabled={page === 1}
                      className="px-2.5 py-1.5 text-xs rounded-lg border border-white/10 text-white/60 hover:bg-white/5 disabled:opacity-30 disabled:cursor-not-allowed transition"
                    >
                      First
                    </button>
                    <button
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      disabled={page === 1}
                      className="px-2.5 py-1.5 text-xs rounded-lg border border-white/10 text-white/60 hover:bg-white/5 disabled:opacity-30 disabled:cursor-not-allowed transition"
                    >
                      Prev
                    </button>
                    <span className="px-3 py-1.5 text-xs text-white/60">
                      Page {page} of {totalPages}
                    </span>
                    <button
                      onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                      disabled={page === totalPages}
                      className="px-2.5 py-1.5 text-xs rounded-lg border border-white/10 text-white/60 hover:bg-white/5 disabled:opacity-30 disabled:cursor-not-allowed transition"
                    >
                      Next
                    </button>
                    <button
                      onClick={() => setPage(totalPages)}
                      disabled={page === totalPages}
                      className="px-2.5 py-1.5 text-xs rounded-lg border border-white/10 text-white/60 hover:bg-white/5 disabled:opacity-30 disabled:cursor-not-allowed transition"
                    >
                      Last
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}
