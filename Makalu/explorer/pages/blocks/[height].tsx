import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';

import { TxStatusBadge } from '@/components/Badges';
import DataTable, { type Column } from '@/components/DataTable';
import ErrorState from '@/components/ErrorState';
import { FormattedValueElement } from '@/components/FormattedValueElement';
import Loading from '@/components/Loading';
import { useApi } from '@/lib/api';
import { EXPLORER_TITLE } from '@/lib/constants';
import { formatNumber, formatTimestamp, timeAgo, truncateHash, formatValue } from '@/lib/format';
import { NETWORK } from '@/lib/network';
import { getPreferredTxHash } from '@/lib/tx';

import type { ApiBlock, ApiTx, StatsSummary } from '@/lib/types';

function CopyBtn({ text }: { text: string }) {
  const copy = () => navigator.clipboard?.writeText(text).catch(() => {});
  return (
    <button
      onClick={copy}
      className="ml-2 rounded-lg border border-white/10 bg-white/5 px-2 py-0.5 text-xs text-white/50 hover:text-white/80 transition"
      title="Copy"
    >
      copy
    </button>
  );
}

function Row({ label, children, tooltip }: { label: string; children: React.ReactNode; tooltip?: string }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-start gap-1 sm:gap-4 py-4 border-b border-white/5 last:border-0">
      <div className="sm:w-48 shrink-0 text-sm text-white/45" title={tooltip}>{label}</div>
      <div className="flex-1 text-sm text-white break-all">{children}</div>
    </div>
  );
}

const BLOCK_TX_PAGE_SIZE = 25;
type BlockTxStatusFilter = 'all' | 'success' | 'failed';
type BlockTxTypeFilter = 'all' | 'transfer' | 'call' | 'create';

function buildPaginationItems(currentPage: number, totalPages: number): Array<number | string> {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }

  const items: Array<number | string> = [1];
  const windowStart = Math.max(2, currentPage - 1);
  const windowEnd = Math.min(totalPages - 1, currentPage + 1);

  if (windowStart > 2) {
    items.push('ellipsis-start');
  }

  for (let page = windowStart; page <= windowEnd; page += 1) {
    items.push(page);
  }

  if (windowEnd < totalPages - 1) {
    items.push('ellipsis-end');
  }

  items.push(totalPages);
  return items;
}

export default function BlockDetailPage() {
  const router = useRouter();
  const { height, page, q, status, type } = router.query;
  const pageParam = Array.isArray(page) ? page[0] : page;
  const searchQuery = typeof q === 'string' ? q.trim() : '';
  const statusQuery = typeof status === 'string' ? status : '';
  const typeQuery = typeof type === 'string' ? type : '';
  const statusFilter: BlockTxStatusFilter = statusQuery === 'success' || statusQuery === 'failed'
    ? statusQuery
    : 'all';
  const typeFilter: BlockTxTypeFilter = typeQuery === 'transfer' || typeQuery === 'call' || typeQuery === 'create'
    ? typeQuery
    : 'all';
  const requestedPage = Number.isFinite(Number(pageParam)) && Number(pageParam) > 0
    ? Math.floor(Number(pageParam))
    : 1;
  const txOffset = (requestedPage - 1) * BLOCK_TX_PAGE_SIZE;
  const blockNum = Number(height);
  const [searchInput, setSearchInput] = useState(searchQuery);

  useEffect(() => {
    setSearchInput(searchQuery);
  }, [searchQuery]);

  const blockQuery = new URLSearchParams({
    limit: String(BLOCK_TX_PAGE_SIZE),
    offset: String(txOffset),
  });

  if (searchQuery) blockQuery.set('q', searchQuery);
  if (statusFilter !== 'all') blockQuery.set('status', statusFilter);
  if (typeFilter !== 'all') blockQuery.set('type', typeFilter);

  const { data: block, loading, error, refetch } = useApi<ApiBlock>(
    height ? `/blocks/${height}?${blockQuery.toString()}` : null
  );

  const { data: stats } = useApi<StatsSummary>('/stats/summary');
  const tipHeight = stats?.tipHeight ?? 0;
  const confirmations = tipHeight && blockNum ? tipHeight - blockNum + 1 : 0;

  const txColumns: Column<ApiTx>[] = [
    {
      key: 'hash',
      header: 'Tx Hash',
      render: (tx) => {
        const txHash = getPreferredTxHash(tx);
        return txHash ? (
          <Link href={`/txs/${txHash}`} className="font-mono text-emerald-300 hover:text-emerald-200 transition">
            {truncateHash(txHash)}
          </Link>
        ) : (
          <span className="font-mono text-sm text-white/30">Unavailable</span>
        );
      },
    },
    {
      key: 'method',
      header: 'Method',
      render: (tx) => (
        <span className="inline-flex items-center rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-xs font-medium text-white/70 truncate max-w-[120px]" title={tx.methodName ?? tx.txType ?? 'Transfer'}>
          {tx.methodName ?? (tx.txType === 'call' ? 'Call' : tx.txType === 'create' ? 'Create' : 'Transfer')}
        </span>
      ),
    },
    {
      key: 'from',
      header: 'From',
      render: (tx) => (
        <Link href={`/address/${tx.fromAddr}`} className="font-mono text-sm text-emerald-300 hover:text-emerald-200">
          {truncateHash(tx.fromAddr)}
        </Link>
      ),
    },
    {
      key: 'to',
      header: 'To',
      render: (tx) => tx.toAddr ? (
        <Link href={`/address/${tx.toAddr}`} className="font-mono text-sm text-emerald-300 hover:text-emerald-200">
          {truncateHash(tx.toAddr)}
        </Link>
      ) : <span className="text-white/30">&mdash;</span>,
    },
    {
      key: 'value',
      header: 'Value',
      render: (tx) => (
        <span className="text-sm">
          <FormattedValueElement 
            formattedStr={formatValue(tx.value, tx.denom)}
            tokenAddress={tx.contractAddress}
          />
        </span>
      ),
    },
    {
      key: 'fee',
      header: 'Fee',
      render: (tx) => <span className="font-mono text-sm text-white/60">{formatValue(tx.feePaid)}</span>,
    },
    {
      key: 'memo',
      header: 'Memo',
      render: (tx) => {
        const memo = tx.memo?.trim();
        if (!memo) return <span className="text-white/25">&mdash;</span>;
        return (
          <span
            className="block max-w-[160px] truncate font-mono text-xs text-white/65"
            title={memo}
          >
            {memo}
          </span>
        );
      },
    },
    {
      key: 'status',
      header: 'Status',
      render: (tx) => <TxStatusBadge success={tx.success} />,
    },
  ];

  if (error) return <ErrorState message={error} onRetry={refetch} />;
  if (loading) return <Loading lines={8} />;
  if (!block) return <ErrorState message="Block not found" />;

  const blockTxs = block.txs ?? [];
  const matchingTxCount = block.txFilteredCount ?? block.txCount;
  const txPageLimit = block.txLimit ?? BLOCK_TX_PAGE_SIZE;
  const txPageOffset = block.txOffset ?? txOffset;
  const totalTxPages = Math.max(1, Math.ceil(matchingTxCount / Math.max(txPageLimit, 1)));
  const currentTxPage = matchingTxCount === 0
    ? 1
    : Math.min(totalTxPages, Math.floor(txPageOffset / txPageLimit) + 1);
  const txStart = matchingTxCount === 0 ? 0 : txPageOffset + 1;
  const txEnd = Math.min(txPageOffset + blockTxs.length, matchingTxCount);
  const filtersActive = Boolean(searchQuery) || statusFilter !== 'all' || typeFilter !== 'all';
  const pageItems = buildPaginationItems(currentTxPage, totalTxPages);

  const blockPageHref = (
    targetPage: number,
    overrides?: {
      q?: string;
      status?: BlockTxStatusFilter;
      type?: BlockTxTypeFilter;
    }
  ) => {
    const normalizedPage = Math.max(1, Math.min(totalTxPages, targetPage));
    const params = new URLSearchParams();
    const nextSearch = (overrides?.q ?? searchQuery).trim();
    const nextStatus = overrides?.status ?? statusFilter;
    const nextType = overrides?.type ?? typeFilter;

    if (normalizedPage > 1) params.set('page', String(normalizedPage));
    if (nextSearch) params.set('q', nextSearch);
    if (nextStatus !== 'all') params.set('status', nextStatus);
    if (nextType !== 'all') params.set('type', nextType);

    const queryString = params.toString();
    return queryString
      ? `/blocks/${block.height}?${queryString}#transactions`
      : `/blocks/${block.height}#transactions`;
  };

  const handleSearchSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    router.push(blockPageHref(1, { q: searchInput }));
  };

  const handleStatusChange = (nextStatus: BlockTxStatusFilter) => {
    router.push(blockPageHref(1, { status: nextStatus }));
  };

  const handleTypeChange = (nextType: BlockTxTypeFilter) => {
    router.push(blockPageHref(1, { type: nextType }));
  };

  return (
    <>
      <Head>
        <title>Block #{height} | {EXPLORER_TITLE}</title>
        <meta name="description" content={`View ${NETWORK.label} details and transactions for block ${height}.`} />
      </Head>

      <div className="text-white">
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 text-sm text-white/40 mb-6">
          <Link href="/" className="hover:text-white/70 transition">Home</Link>
          <span>/</span>
          <Link href="/blocks" className="hover:text-white/70 transition">Blocks</Link>
          <span>/</span>
          <span className="text-white/70 font-mono">#{formatNumber(block.height)}</span>
        </div>

        {/* Title + Navigation */}
        <div className="flex flex-wrap items-center gap-3 mb-6">
          <h1 className="text-2xl font-semibold">Block #{formatNumber(block.height)}</h1>
          <div className="flex items-center gap-1 ml-auto">
            {blockNum > 1 && (
              <Link
                href={`/blocks/${blockNum - 1}`}
                className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm hover:bg-white/10 transition"
              >
                &larr; Prev
              </Link>
            )}
            {tipHeight > blockNum && (
              <Link
                href={`/blocks/${blockNum + 1}`}
                className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm hover:bg-white/10 transition"
              >
                Next &rarr;
              </Link>
            )}
          </div>
        </div>

        {/* Overview Card */}
        <div className="rounded-3xl border border-white/10 bg-white/5 px-6 py-2 mb-6">
          <Row label="Block Height">
            <span className="font-mono">{formatNumber(block.height)}</span>
          </Row>

          <Row label="Timestamp">
            <span>{formatTimestamp(block.timestamp)}</span>
            <span className="ml-2 text-white/40">({timeAgo(block.timestamp)})</span>
          </Row>

          <Row label="Transactions">
            <span>
              {block.txCount === 0 ? (
                '0 transactions'
              ) : (
                <>
                  <span className="text-emerald-300">{block.txCount} transaction{block.txCount !== 1 ? 's' : ''}</span>
                  {' '}in this block
                </>
              )}
            </span>
          </Row>

          {block.proposerAddress && (
            <Row label="Validated By" tooltip="The validator who proposed this block">
              <Link
                href={`/address/${block.proposerAddress}`}
                className="font-mono text-emerald-300 hover:text-emerald-200 transition"
              >
                {truncateHash(block.proposerAddress)}
              </Link>
              <CopyBtn text={block.proposerAddress} />
            </Row>
          )}

          <Row label="Block Hash">
            <span className="font-mono">{block.hash}</span>
            <CopyBtn text={block.hash} />
          </Row>

          {block.parentHash && (
            <Row label="Parent Hash">
              <Link
                href={`/blocks/${blockNum - 1}`}
                className="font-mono text-emerald-300 hover:text-emerald-200 transition"
              >
                {block.parentHash}
              </Link>
            </Row>
          )}

          {confirmations > 0 && (
            <Row label="Confirmations" tooltip="Number of blocks confirmed since this block">
              <span className="inline-flex items-center rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-0.5 text-xs text-emerald-300">
                {formatNumber(confirmations)} Block Confirmations
              </span>
            </Row>
          )}

          <Row label="Gas Used">
            <span className="font-mono">{formatNumber(block.gasUsed)}</span>
          </Row>
        </div>

        {/* Genesis Information — block #1 only */}
        {blockNum === 1 && (block.chainId || block.genesisTime || block.genesisHash) && (
          <div className="rounded-3xl border border-emerald-400/20 bg-emerald-400/5 px-6 py-2 mb-6">
            <div className="flex items-center gap-2 py-4 border-b border-white/5">
              <span className="inline-flex items-center rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2.5 py-0.5 text-xs font-medium text-emerald-200">
                Genesis
              </span>
              <span className="text-sm text-white/60">
                Network metadata baked into the chain at genesis. Block #1 itself carries no memo field — the chain memo lives in <code className="font-mono text-white/75">genesis.json</code> and is summarized below.
              </span>
            </div>

            {block.chainId && (
              <Row label="Chain ID">
                <span className="font-mono">{block.chainId}</span>
                <CopyBtn text={block.chainId} />
              </Row>
            )}

            {block.genesisTime && (
              <Row label="Genesis Time">
                <span>{formatTimestamp(block.genesisTime)}</span>
                <span className="ml-2 text-white/40">({timeAgo(block.genesisTime)})</span>
              </Row>
            )}

            {block.genesisHash && (
              <Row label="Genesis Hash" tooltip="SHA-256 of genesis.json — uniquely identifies the network">
                <span className="font-mono break-all">{block.genesisHash}</span>
                <CopyBtn text={block.genesisHash} />
              </Row>
            )}
          </div>
        )}

        {/* Transactions Table */}
        {block.txCount > 0 ? (
          <div id="transactions" className="rounded-3xl border border-white/10 bg-white/5 p-6">
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">
                  Transactions ({formatNumber(block.txCount)})
                </h2>
                {matchingTxCount > 0 ? (
                  <div className="mt-1 text-sm text-white/40">
                    Showing {formatNumber(txStart)} to {formatNumber(txEnd)} of {formatNumber(matchingTxCount)}
                    {filtersActive && (
                      <span>{' '}matching transaction{matchingTxCount === 1 ? '' : 's'}</span>
                    )}
                  </div>
                ) : (
                  <div className="mt-1 text-sm text-white/40">
                    No transactions match the current filters.
                  </div>
                )}
                {filtersActive && (
                  <div className="mt-1 text-xs text-white/30">
                    Filtered from {formatNumber(block.txCount)} total transaction{block.txCount === 1 ? '' : 's'} in this block
                  </div>
                )}
              </div>
              {totalTxPages > 1 && (
                <div className="text-sm text-white/40">
                  Page {formatNumber(currentTxPage)} of {formatNumber(totalTxPages)}
                </div>
              )}
            </div>
            <div className="mb-5 rounded-2xl border border-white/10 bg-black/20 p-4">
              <div className="grid gap-3 lg:grid-cols-[minmax(0,1.35fr)_minmax(12rem,0.8fr)_minmax(12rem,0.8fr)_auto] lg:items-end">
                <form onSubmit={handleSearchSubmit} className="min-w-0">
                  <label className="mb-2 block text-[11px] font-medium uppercase tracking-[0.22em] text-white/35">
                    Search
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={searchInput}
                      onChange={(event) => setSearchInput(event.target.value)}
                      placeholder="Tx hash, address, or memo"
                      className="min-w-0 flex-1 rounded-2xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white placeholder-white/30 focus:border-emerald-400/50 focus:outline-none focus:ring-1 focus:ring-emerald-400/30"
                    />
                    <button
                      type="submit"
                      className="shrink-0 rounded-2xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white/75 transition hover:bg-white/10 hover:text-white"
                    >
                      Apply
                    </button>
                  </div>
                </form>
                <div>
                  <label className="mb-2 block text-[11px] font-medium uppercase tracking-[0.22em] text-white/35">
                    Status
                  </label>
                  <select
                    value={statusFilter}
                    onChange={(event) => handleStatusChange(event.target.value as BlockTxStatusFilter)}
                    className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white focus:border-emerald-400/50 focus:outline-none focus:ring-1 focus:ring-emerald-400/30"
                  >
                    <option value="all">All statuses</option>
                    <option value="success">Success</option>
                    <option value="failed">Failed</option>
                  </select>
                </div>
                <div>
                  <label className="mb-2 block text-[11px] font-medium uppercase tracking-[0.22em] text-white/35">
                    Type
                  </label>
                  <select
                    value={typeFilter}
                    onChange={(event) => handleTypeChange(event.target.value as BlockTxTypeFilter)}
                    className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white focus:border-emerald-400/50 focus:outline-none focus:ring-1 focus:ring-emerald-400/30"
                  >
                    <option value="all">All types</option>
                    <option value="transfer">Transfer</option>
                    <option value="call">Call</option>
                    <option value="create">Create</option>
                  </select>
                </div>
                {filtersActive && (
                  <Link
                    href={blockPageHref(1, { q: '', status: 'all', type: 'all' })}
                    className="inline-flex h-[42px] items-center justify-center rounded-2xl border border-white/10 bg-white/5 px-4 text-sm text-white/70 transition hover:bg-white/10 hover:text-white"
                  >
                    Clear filters
                  </Link>
                )}
              </div>
            </div>
            <DataTable
              columns={txColumns}
              data={blockTxs}
              emptyMessage={filtersActive ? 'No transactions match the current filters.' : 'No transactions in this block.'}
              rowKey={(tx) => getPreferredTxHash(tx) ?? `${tx.blockHeight}-${tx.fromAddr}-${tx.toAddr ?? 'none'}-${tx.timestamp ?? 'unknown'}`}
            />
            {matchingTxCount > 0 && totalTxPages > 1 && (
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                <div className="text-sm text-white/40">
                  Page {formatNumber(currentTxPage)} of {formatNumber(totalTxPages)}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Link
                    href={blockPageHref(1)}
                    className={`rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/70 transition hover:bg-white/10 ${currentTxPage === 1 ? 'pointer-events-none opacity-30' : ''}`}
                    aria-disabled={currentTxPage === 1}
                  >
                    First
                  </Link>
                  <Link
                    href={blockPageHref(currentTxPage - 1)}
                    className={`rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/70 transition hover:bg-white/10 ${currentTxPage === 1 ? 'pointer-events-none opacity-30' : ''}`}
                    aria-disabled={currentTxPage === 1}
                  >
                    Previous
                  </Link>
                  {pageItems.map((item, index) => (
                    typeof item === 'number' ? (
                      <Link
                        key={item}
                        href={blockPageHref(item)}
                        className={`rounded-2xl border px-4 py-2 text-sm transition ${
                          item === currentTxPage
                            ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200'
                            : 'border-white/10 bg-white/5 text-white/70 hover:bg-white/10'
                        }`}
                        aria-current={item === currentTxPage ? 'page' : undefined}
                      >
                        {item}
                      </Link>
                    ) : (
                      <span
                        key={`${item}-${index}`}
                        className="inline-flex items-center px-2 text-sm text-white/30"
                      >
                        ...
                      </span>
                    )
                  ))}
                  <Link
                    href={blockPageHref(currentTxPage + 1)}
                    className={`rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/70 transition hover:bg-white/10 ${currentTxPage >= totalTxPages ? 'pointer-events-none opacity-30' : ''}`}
                    aria-disabled={currentTxPage >= totalTxPages}
                  >
                    Next
                  </Link>
                  <Link
                    href={blockPageHref(totalTxPages)}
                    className={`rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/70 transition hover:bg-white/10 ${currentTxPage >= totalTxPages ? 'pointer-events-none opacity-30' : ''}`}
                    aria-disabled={currentTxPage >= totalTxPages}
                  >
                    Last
                  </Link>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="rounded-3xl border border-white/10 bg-white/5 p-8 text-center text-white/40">
            No transactions in this block.
          </div>
        )}
      </div>
    </>
  );
}
