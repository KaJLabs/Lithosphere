import { useState, useCallback, useEffect } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useApi } from '@/lib/api';
import { EXPLORER_TITLE } from '@/lib/constants';
import { formatNumber, formatSupply, truncateHash, timeAgo, formatTimestamp, formatValue } from '@/lib/format';
import { isValidTransactionHash } from '@/lib/tx';
import type {
  ApiTokenDetail,
  ApiTokenTransferList,
  ApiTokenHolderList,
} from '@/lib/types';

/* ── Constants ────────────────────────────────────────────────────────── */

const TABS = [
  { key: 'transfers', label: 'Transfers' },
  { key: 'holders', label: 'Holders' },
  { key: 'contract', label: 'Contract' },
  { key: 'info', label: 'Info' },
] as const;

type TabKey = (typeof TABS)[number]['key'];

const PER_PAGE = 25;
const TOKEN_TRANSFERS_GRID_CLASS = 'lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1.4fr)_minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,0.8fr)]';

function isNativeAsset(token: Pick<ApiTokenDetail, 'type'>): boolean {
  return token.type === 'native';
}

function isNftAsset(token: Pick<ApiTokenDetail, 'type'>): boolean {
  return token.type === 'LEP100-6';
}

function getAssetBadgeLabel(token: Pick<ApiTokenDetail, 'type'>): string {
  if (isNativeAsset(token)) return 'Native';
  if (isNftAsset(token)) return 'LEP100-6';
  return 'LEP-100';
}

function getAssetBadgeClasses(token: Pick<ApiTokenDetail, 'type'>): string {
  if (isNativeAsset(token)) {
    return 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20';
  }
  if (isNftAsset(token)) {
    return 'bg-amber-500/10 text-amber-300 border-amber-500/20';
  }
  return 'bg-violet-500/10 text-violet-300 border-violet-500/20';
}

function getAssetTypeLabel(token: Pick<ApiTokenDetail, 'type'>): string {
  if (isNativeAsset(token)) return 'Native Chain Asset';
  if (isNftAsset(token)) return 'NFT Collection';
  return 'LEP-100 Token';
}

function getAssetStandard(token: Pick<ApiTokenDetail, 'type' | 'standard'>): string {
  if (token.standard) return token.standard;
  if (isNativeAsset(token)) return 'Native';
  if (isNftAsset(token)) return 'LEP100-6';
  return 'LEP-100';
}

function formatCount(value: number | null | undefined): string {
  return value == null ? '--' : formatNumber(value);
}

function formatSupplyValue(raw: string | null | undefined, decimals: number): string {
  return raw ? formatSupply(raw, decimals) : '--';
}

/* ── Small helpers ────────────────────────────────────────────────────── */

function CopyBtn({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = useCallback(() => {
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => {});
  }, [text]);

  return (
    <button
      onClick={copy}
      className="ml-2 rounded-lg border border-white/10 bg-white/5 px-2 py-0.5 text-xs text-white/50 hover:text-white/80 transition"
      title="Copy to clipboard"
    >
      {copied ? 'copied!' : 'copy'}
    </button>
  );
}

/* ── Add-to-Wallet (EIP-747) ──────────────────────────────────────────── */

type WatchAssetProvider = {
  request: (args: { method: string; params: unknown }) => Promise<unknown>;
};

function AddToWalletBtn({
  address,
  symbol,
  decimals,
  image,
}: {
  address: string;
  symbol: string;
  decimals: number;
  image?: string;
}) {
  const [status, setStatus] = useState<'idle' | 'adding' | 'added' | 'unavailable' | 'rejected'>('idle');

  const handleAdd = useCallback(async () => {
    const eth = (typeof window !== 'undefined'
      ? (window as unknown as { ethereum?: WatchAssetProvider }).ethereum
      : undefined);
    if (!eth?.request) {
      setStatus('unavailable');
      setTimeout(() => setStatus('idle'), 2500);
      return;
    }

    setStatus('adding');
    try {
      const added = await eth.request({
        method: 'wallet_watchAsset',
        params: {
          type: 'ERC20',
          options: {
            address,
            symbol: symbol.slice(0, 11),
            decimals,
            ...(image ? { image } : {}),
          },
        },
      });
      setStatus(added ? 'added' : 'rejected');
    } catch {
      setStatus('rejected');
    } finally {
      setTimeout(() => setStatus('idle'), 2500);
    }
  }, [address, symbol, decimals, image]);

  const label =
    status === 'adding' ? 'Adding…' :
    status === 'added' ? 'Added to wallet' :
    status === 'unavailable' ? 'No wallet detected' :
    status === 'rejected' ? 'Not added' :
    'Add to Wallet';

  return (
    <button
      onClick={handleAdd}
      disabled={status === 'adding'}
      className="inline-flex items-center gap-1.5 rounded-2xl border border-emerald-400/30 bg-emerald-400/10 px-3 py-2 text-xs font-medium text-emerald-200 transition hover:bg-emerald-400/20 disabled:opacity-60"
      title="Add this token to MetaMask or compatible wallet"
    >
      <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
        <path fillRule="evenodd" d="M10 3a.75.75 0 01.75.75v5.5h5.5a.75.75 0 010 1.5h-5.5v5.5a.75.75 0 01-1.5 0v-5.5h-5.5a.75.75 0 010-1.5h5.5v-5.5A.75.75 0 0110 3z" clipRule="evenodd" />
      </svg>
      {label}
    </button>
  );
}

function TableSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex gap-4 px-5 py-4 border-b border-white/5 animate-pulse">
          <div className="h-4 rounded bg-white/10 w-1/3" />
          <div className="h-4 rounded bg-white/10 w-1/6" />
          <div className="h-4 rounded bg-white/10 w-1/4" />
          <div className="h-4 rounded bg-white/10 w-1/4" />
        </div>
      ))}
    </div>
  );
}

function PageSkeleton() {
  return (
    <div className="text-white animate-pulse space-y-6">
      <div className="h-5 rounded bg-white/10 w-32" />
      <div className="flex items-center gap-4">
        <div className="w-14 h-14 rounded-full bg-white/10" />
        <div className="space-y-2">
          <div className="h-8 rounded bg-white/10 w-48" />
          <div className="h-4 rounded bg-white/10 w-24" />
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-3xl border border-white/10 bg-white/5 p-5 space-y-3">
            <div className="h-3 rounded bg-white/10 w-20" />
            <div className="h-6 rounded bg-white/10 w-28" />
          </div>
        ))}
      </div>
      <div className="rounded-3xl border border-white/10 bg-white/5 p-5 space-y-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex gap-4">
            <div className="h-4 rounded bg-white/10 w-1/4" />
            <div className="h-4 rounded bg-white/10 w-2/3" />
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Transfers Tab ────────────────────────────────────────────────────── */

function TransfersTab({ address, decimals, symbol, isNft }: { address: string; decimals: number; symbol: string; isNft?: boolean }) {
  const [page, setPage] = useState(0);
  const offset = page * PER_PAGE;
  const { data, loading } = useApi<ApiTokenTransferList>(
    `/tokens/${address}/transfers?limit=${PER_PAGE}&offset=${offset}`
  );

  const transfers = data?.transfers ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));

  if (loading && transfers.length === 0) return <TableSkeleton />;

  if (transfers.length === 0) {
    return (
      <div className="py-16 text-center text-white/40">
        <div className="text-base font-medium mb-1">No transfers found</div>
        <div className="text-sm">This token has no indexed transfer activity yet.</div>
      </div>
    );
  }

  return (
    <>
      {/* Header */}
      <div className="px-5 py-3 border-b border-white/10 text-xs text-white/40">
        A total of {formatNumber(total)} transfer{total !== 1 ? 's' : ''} found
      </div>
      <div className="overflow-x-auto">
        <div className="min-w-0">
          <div className={`hidden lg:grid ${TOKEN_TRANSFERS_GRID_CLASS} gap-4 border-b border-white/10 px-5 py-3 text-[11px] font-medium uppercase tracking-[0.24em] text-white/40`}>
            <div>Tx Hash</div>
            <div>From</div>
            <div>To</div>
            <div className="text-right">{isNft ? 'Token ID' : 'Value'}</div>
            <div className="text-right">Age</div>
          </div>

          <div>
            {transfers.map((tx, i) => {
              const txHash = isValidTransactionHash(tx.txHash) ? tx.txHash : null;
              return (
              <div
                key={`${txHash ?? 'missing'}-${i}`}
                className={`grid grid-cols-1 ${TOKEN_TRANSFERS_GRID_CLASS} gap-3 border-b border-white/5 px-5 py-4 transition hover:bg-white/[0.03] lg:gap-4`}
              >
                <div className="flex min-w-0 items-center">
                  {txHash ? (
                    <Link
                      href={`/txs/${txHash}`}
                      className="block truncate font-mono text-sm text-emerald-300 transition hover:text-emerald-200"
                      title={txHash}
                    >
                      {truncateHash(txHash)}
                    </Link>
                  ) : (
                    <span className="block truncate font-mono text-sm text-white/30">Unavailable</span>
                  )}
                </div>

                <div className="flex min-w-0 items-center">
                  <span className="mr-2 w-12 shrink-0 text-xs text-white/40 lg:hidden">From</span>
                  <Link
                    href={`/address/${tx.fromAddress}`}
                    className="block truncate font-mono text-sm text-emerald-300 transition hover:text-emerald-200"
                    title={tx.fromAddress}
                  >
                    {truncateHash(tx.fromAddress, 10, 6)}
                  </Link>
                </div>

                <div className="flex min-w-0 items-center">
                  <span className="mr-2 w-12 shrink-0 text-xs text-white/40 lg:hidden">To</span>
                  <Link
                    href={`/address/${tx.toAddress}`}
                    className="block truncate font-mono text-sm text-emerald-300 transition hover:text-emerald-200"
                    title={tx.toAddress}
                  >
                    {truncateHash(tx.toAddress, 10, 6)}
                  </Link>
                </div>

                <div className="flex min-w-0 items-center lg:justify-end">
                  <span className="mr-2 w-12 shrink-0 text-xs text-white/40 lg:hidden">{isNft ? 'Token ID' : 'Value'}</span>
                  <span className="block min-w-0 text-sm font-mono text-white/80">
                    {tx.tokenId != null ? `#${tx.tokenId}` : `${formatSupply(tx.value, decimals)} ${symbol}`}
                  </span>
                </div>

                <div className="flex min-w-0 items-center lg:justify-end">
                  <span className="mr-2 w-12 shrink-0 text-xs text-white/40 lg:hidden">Age</span>
                  <span className="text-sm text-white/50" title={formatTimestamp(tx.timestamp)}>
                    {timeAgo(tx.timestamp)}
                  </span>
                </div>
              </div>
            )})}
          </div>
        </div>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex flex-col gap-3 px-5 py-4 border-t border-white/10 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-white/30">
            Showing {offset + 1} to {Math.min(offset + PER_PAGE, total)} of {formatNumber(total)}
          </p>
          <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:gap-1">
            <span className="text-xs text-white/60 sm:px-3 sm:py-1.5">
              Page {page + 1} of {totalPages}
            </span>
            <div className="grid grid-cols-4 gap-2 sm:flex sm:items-center sm:gap-1">
              <button
                onClick={() => setPage(0)}
                disabled={page === 0}
                className="min-w-0 px-2.5 py-1.5 text-xs rounded-lg border border-white/10 text-white/60 hover:bg-white/5 disabled:opacity-30 disabled:cursor-not-allowed transition"
              >
                First
              </button>
              <button
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
                className="min-w-0 px-2.5 py-1.5 text-xs rounded-lg border border-white/10 text-white/60 hover:bg-white/5 disabled:opacity-30 disabled:cursor-not-allowed transition"
              >
                Prev
              </button>
              <button
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                disabled={page >= totalPages - 1}
                className="min-w-0 px-2.5 py-1.5 text-xs rounded-lg border border-white/10 text-white/60 hover:bg-white/5 disabled:opacity-30 disabled:cursor-not-allowed transition"
              >
                Next
              </button>
              <button
                onClick={() => setPage(totalPages - 1)}
                disabled={page >= totalPages - 1}
                className="min-w-0 px-2.5 py-1.5 text-xs rounded-lg border border-white/10 text-white/60 hover:bg-white/5 disabled:opacity-30 disabled:cursor-not-allowed transition"
              >
                Last
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/* ── Holders Tab ──────────────────────────────────────────────────────── */

function HoldersTab({ address, decimals, symbol, totalSupply }: { address: string; decimals: number; symbol: string; totalSupply?: string }) {
  const [page, setPage] = useState(0);
  const offset = page * PER_PAGE;
  const { data, loading } = useApi<ApiTokenHolderList>(
    `/tokens/${address}/holders?limit=${PER_PAGE}&offset=${offset}`
  );

  const holders = data?.holders ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));

  if (loading && holders.length === 0) return <TableSkeleton />;

  if (holders.length === 0) {
    return (
      <div className="py-16 text-center text-white/40">
        <div className="text-base font-medium mb-1">No holders found</div>
        <div className="text-sm">Holder data is not yet available for this token.</div>
      </div>
    );
  }

  return (
    <>
      {/* Header */}
      <div className="px-5 py-3 border-b border-white/10 text-xs text-white/40">
        A total of {formatNumber(total)} holder{total !== 1 ? 's' : ''} found
      </div>

      {/* Desktop header */}
      <div className="hidden md:grid grid-cols-[0.4fr_2fr_1.2fr_0.8fr] gap-4 px-5 py-3 border-b border-white/10 text-xs font-medium text-white/40 uppercase tracking-wide">
        <div>Rank</div>
        <div>Address</div>
        <div className="text-right">Balance</div>
        <div className="text-right">Percentage</div>
      </div>

      {/* Rows */}
      <div>
        {holders.map((h, i) => (
          <div
            key={h.address}
            className="grid grid-cols-1 md:grid-cols-[0.4fr_2fr_1.2fr_0.8fr] gap-3 md:gap-4 px-5 py-4 border-b border-white/5 hover:bg-white/[0.03] transition"
          >
            {/* Rank */}
            <div className="flex items-center">
              <span className="text-sm text-white/40">{offset + i + 1}</span>
            </div>

            {/* Address */}
            <div className="flex items-center">
              <Link
                href={`/address/${h.address}`}
                className="font-mono text-sm text-emerald-300 hover:text-emerald-200 transition truncate"
              >
                {h.address}
              </Link>
            </div>

            {/* Balance */}
            <div className="flex items-center md:justify-end">
              <span className="md:hidden text-xs text-white/40 mr-2 w-16 shrink-0">Balance</span>
              <span className="text-sm font-mono text-white/80">
                {formatSupply(h.balance, decimals)} {symbol}
              </span>
            </div>

            {/* Percentage */}
            <div className="flex items-center md:justify-end">
              <span className="md:hidden text-xs text-white/40 mr-2 w-16 shrink-0">Share</span>
              <div className="flex items-center gap-2">
                <div className="hidden md:block w-16 h-1.5 rounded-full bg-white/10 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-emerald-400"
                    style={{ width: `${Math.min(100, h.percentage)}%` }}
                  />
                </div>
                <span className="text-sm text-white/60">{h.percentage.toFixed(2)}%</span>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex flex-col gap-3 px-5 py-4 border-t border-white/10 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-white/30">
            Showing {offset + 1} to {Math.min(offset + PER_PAGE, total)} of {formatNumber(total)}
          </p>
          <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:gap-1">
            <span className="text-xs text-white/60 sm:px-3 sm:py-1.5">
              Page {page + 1} of {totalPages}
            </span>
            <div className="grid grid-cols-4 gap-2 sm:flex sm:items-center sm:gap-1">
              <button
                onClick={() => setPage(0)}
                disabled={page === 0}
                className="min-w-0 px-2.5 py-1.5 text-xs rounded-lg border border-white/10 text-white/60 hover:bg-white/5 disabled:opacity-30 disabled:cursor-not-allowed transition"
              >
                First
              </button>
              <button
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
                className="min-w-0 px-2.5 py-1.5 text-xs rounded-lg border border-white/10 text-white/60 hover:bg-white/5 disabled:opacity-30 disabled:cursor-not-allowed transition"
              >
                Prev
              </button>
              <button
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                disabled={page >= totalPages - 1}
                className="min-w-0 px-2.5 py-1.5 text-xs rounded-lg border border-white/10 text-white/60 hover:bg-white/5 disabled:opacity-30 disabled:cursor-not-allowed transition"
              >
                Next
              </button>
              <button
                onClick={() => setPage(totalPages - 1)}
                disabled={page >= totalPages - 1}
                className="min-w-0 px-2.5 py-1.5 text-xs rounded-lg border border-white/10 text-white/60 hover:bg-white/5 disabled:opacity-30 disabled:cursor-not-allowed transition"
              >
                Last
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/* ── Contract Tab ─────────────────────────────────────────────────────── */

function ContractTab({ token }: { token: ApiTokenDetail }) {
  const rawCreationTx = typeof token.creationTx === 'string' ? token.creationTx.trim() : '';
  const creationTxHash = isValidTransactionHash(rawCreationTx) ? rawCreationTx : null;
  const hasCreationTx = rawCreationTx.length > 0;

  return (
    <div className="p-6 space-y-6">
      {/* Verification badge */}
      <div className="flex items-center gap-3">
        <div className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium ${
          token.verified
            ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300'
            : 'border-yellow-400/30 bg-yellow-400/10 text-yellow-300'
        }`}>
          {token.verified ? (
            <>
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" clipRule="evenodd" /></svg>
              Contract Source Verified
            </>
          ) : (
            <>
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-8-5a.75.75 0 01.75.75v4.5a.75.75 0 01-1.5 0v-4.5A.75.75 0 0110 5zm0 10a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" /></svg>
              Contract Not Verified
            </>
          )}
        </div>
      </div>

      {/* Contract details */}
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] overflow-hidden">
        <div className="px-5 py-3 border-b border-white/10 text-sm font-medium text-white/60">Contract Overview</div>

        <div className="divide-y divide-white/5">
          <div className="flex flex-col sm:flex-row sm:items-start gap-1 sm:gap-4 px-5 py-4">
            <div className="sm:w-44 shrink-0 text-sm text-white/45">Contract Address</div>
            <div className="flex-1 text-sm text-white font-mono break-all">
              {token.contractAddress ?? token.address}
              <CopyBtn text={token.contractAddress ?? token.address} />
            </div>
          </div>

          {token.creator && (
            <div className="flex flex-col sm:flex-row sm:items-start gap-1 sm:gap-4 px-5 py-4">
              <div className="sm:w-44 shrink-0 text-sm text-white/45">Creator</div>
              <div className="flex-1 text-sm">
                <Link href={`/address/${token.creator}`} className="font-mono text-emerald-300 hover:text-emerald-200 transition break-all">
                  {token.creator}
                </Link>
              </div>
            </div>
          )}

          {hasCreationTx && (
            <div className="flex flex-col sm:flex-row sm:items-start gap-1 sm:gap-4 px-5 py-4">
              <div className="sm:w-44 shrink-0 text-sm text-white/45">Creation Tx</div>
              <div className="flex-1 text-sm">
                {creationTxHash ? (
                  <Link href={`/txs/${creationTxHash}`} className="font-mono text-emerald-300 hover:text-emerald-200 transition break-all">
                    {creationTxHash}
                  </Link>
                ) : (
                  <span className="font-mono text-white/30">Unavailable</span>
                )}
              </div>
            </div>
          )}

          {token.creationBlock != null && (
            <div className="flex flex-col sm:flex-row sm:items-start gap-1 sm:gap-4 px-5 py-4">
              <div className="sm:w-44 shrink-0 text-sm text-white/45">Creation Block</div>
              <div className="flex-1 text-sm">
                <Link href={`/blocks/${token.creationBlock}`} className="font-mono text-emerald-300 hover:text-emerald-200 transition">
                  #{formatNumber(token.creationBlock)}
                </Link>
              </div>
            </div>
          )}

          <div className="flex flex-col sm:flex-row sm:items-start gap-1 sm:gap-4 px-5 py-4">
            <div className="sm:w-44 shrink-0 text-sm text-white/45">Token Standard</div>
            <div className="flex-1 text-sm text-white">
              {getAssetStandard(token)}
            </div>
          </div>
        </div>
      </div>

      {/* ABI section (stub) */}
      {token.type !== 'native' && (
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] overflow-hidden">
          <div className="px-5 py-3 border-b border-white/10 text-sm font-medium text-white/60">Contract ABI</div>
          <div className="p-5">
            <div className="rounded-xl bg-black/30 border border-white/5 p-4 font-mono text-xs text-white/40 overflow-auto max-h-60">
              {token.verified
                ? '// ABI will be displayed here once contract verification is complete.'
                : '// Contract source not verified. Submit verification to view the ABI.'}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Roles Section ────────────────────────────────────────────────────── */

interface TokenRole {
  role: string;
  roleHash: string;
  account: string;
  block: number;
  txHash: string;
}

function RolesSection({ contractAddress }: { contractAddress: string }) {
  const { data } = useApi<{ roles: TokenRole[] }>(`/tokens/${contractAddress}/roles`);
  const [expanded, setExpanded] = useState(true);
  const roles = data?.roles ?? [];

  if (roles.length === 0) return null;

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-5 py-3 border-b border-white/10 text-sm font-medium text-white/60 hover:bg-white/[0.02] transition"
      >
        <span>Roles</span>
        <svg className={`w-4 h-4 transition-transform ${expanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {expanded && (
        <div className="divide-y divide-white/5">
          {roles.map((r, i) => {
            const txHash = isValidTransactionHash(r.txHash) ? r.txHash : null;

            return (
              <div key={i} className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 px-5 py-3">
                <div className="sm:w-36 shrink-0 text-sm font-medium text-white/70">{r.role}</div>
                <div className="flex-1 text-sm font-mono text-emerald-300 break-all">
                  <Link href={`/address/${r.account}`} className="hover:text-emerald-200 transition">
                    {r.account}
                  </Link>
                </div>
                <div className="text-xs text-white/40 shrink-0">
                  {txHash ? (
                    <Link href={`/txs/${txHash}`} className="hover:text-white/60 transition">
                      Grant
                    </Link>
                  ) : (
                    <span className="text-white/20">Unavailable</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ── Info Tab ─────────────────────────────────────────────────────────── */

function InfoTab({ token }: { token: ApiTokenDetail }) {
  const isNative = isNativeAsset(token);
  const isNft = isNftAsset(token);
  const rawCreationTx = typeof token.creationTx === 'string' ? token.creationTx.trim() : '';
  const creationTxHash = isValidTransactionHash(rawCreationTx) ? rawCreationTx : null;
  const hasCreationTx = rawCreationTx.length > 0;

  return (
    <div className="p-6 space-y-6">
      {/* Description */}
      {token.description && (
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
          <h3 className="text-sm font-medium text-white/60 mb-3">About {token.name}</h3>
          <p className="text-sm text-white/80 leading-relaxed">{token.description}</p>
        </div>
      )}

      {/* Roles (LEP-100 AccessControl) */}
      {token.contractAddress && !isNft && <RolesSection contractAddress={token.contractAddress} />}

      {/* Token Profile */}
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] overflow-hidden">
        <div className="px-5 py-3 border-b border-white/10 text-sm font-medium text-white/60">Token Profile</div>

        <div className="divide-y divide-white/5">
          <InfoRow label="Name" value={token.name} />
          <InfoRow label="Symbol" value={token.symbol} mono />
          <InfoRow label="Decimals" value={String(token.decimals)} mono />
          <InfoRow label="Type" value={getAssetTypeLabel(token)} />
          <InfoRow label="Standard" value={getAssetStandard(token)} />
          {isNative && <InfoRow label="Denom" value="ulitho" mono />}
          <InfoRow label="Chain" value="lithosphere_700777-2" mono />
          <InfoRow label="Chain ID" value="700777" mono />
          <InfoRow
            label="Total Supply"
            value={token.totalSupply ? `${formatSupply(token.totalSupply, token.decimals)} ${token.symbol}` : '--'}
            mono
          />
          <InfoRow label="Holders" value={formatCount(token.holders)} />
          <InfoRow label="Total Transfers" value={formatCount(token.transfers)} />
          {token.contractAddress && (
            <div className="flex flex-col sm:flex-row sm:items-start gap-1 sm:gap-4 px-5 py-4">
              <div className="sm:w-44 shrink-0 text-sm text-white/45">Contract Address</div>
              <div className="flex-1 text-sm font-mono break-all">
                <Link href={`/address/${token.contractAddress}`} className="text-emerald-300 hover:text-emerald-200 transition">
                  {token.contractAddress}
                </Link>
                <CopyBtn text={token.contractAddress} />
              </div>
            </div>
          )}
          {token.creator && (
            <div className="flex flex-col sm:flex-row sm:items-start gap-1 sm:gap-4 px-5 py-4">
              <div className="sm:w-44 shrink-0 text-sm text-white/45">Creator</div>
              <div className="flex-1 text-sm font-mono">
                <Link href={`/address/${token.creator}`} className="text-emerald-300 hover:text-emerald-200 transition break-all">
                  {token.creator}
                </Link>
              </div>
            </div>
          )}
          {token.createdAt && (
            <InfoRow label="Created" value={`${formatTimestamp(token.createdAt)} (${timeAgo(token.createdAt)})`} />
          )}
        </div>
      </div>
    </div>
  );
}

function InfoRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-start gap-1 sm:gap-4 px-5 py-4">
      <div className="sm:w-44 shrink-0 text-sm text-white/45">{label}</div>
      <div className={`flex-1 text-sm text-white ${mono ? 'font-mono' : ''}`}>{value}</div>
    </div>
  );
}

/* ── Main page ────────────────────────────────────────────────────────── */

export default function TokenDetailPage() {
  const router = useRouter();
  const { address: rawAddress, tab: qTab } = router.query;
  const address = typeof rawAddress === 'string' ? rawAddress : '';
  const activeTab: TabKey = typeof qTab === 'string' && TABS.some((t) => t.key === qTab) ? (qTab as TabKey) : 'transfers';

  // Redirect old symbol-based URLs (e.g., /token/LITHO → /token/native)
  useEffect(() => {
    if (address && address !== 'native' && !address.startsWith('0x')) {
      router.replace(`/token/native`);
    }
  }, [address, router]);

  const { data: token, loading, error } = useApi<ApiTokenDetail>(
    address ? `/tokens/${address}` : null
  );

  const setTab = useCallback(
    (key: TabKey) => {
      router.push(
        { pathname: router.pathname, query: { address, tab: key } },
        undefined,
        { shallow: true },
      );
    },
    [router, address],
  );

  if (loading) return <PageSkeleton />;

  if (error || !token) {
    return (
      <div className="text-white">
        <div className="rounded-3xl border border-red-400/20 bg-red-400/5 p-8 text-center">
          <div className="text-lg font-medium text-red-300 mb-2">Token Not Found</div>
          <div className="text-sm text-white/50 mb-4">
            {error ?? `No token found at address "${address}".`}
          </div>
          <Link href="/tokens" className="text-sm text-emerald-300 hover:text-emerald-200">
            &larr; Back to Tokens
          </Link>
        </div>
      </div>
    );
  }

  const isNative = isNativeAsset(token);
  const isNft = isNftAsset(token);
  const decimals = token.decimals ?? 18;
  const rawCreationTx = typeof token.creationTx === 'string' ? token.creationTx.trim() : '';
  const creationTxHash = isValidTransactionHash(rawCreationTx) ? rawCreationTx : null;
  const hasCreationTx = rawCreationTx.length > 0;

  return (
    <>
      <Head>
        <title>{token.symbol} ({token.name}) | {EXPLORER_TITLE}</title>
        <meta name="description" content={`View info, holders, and transfers for ${token.name} (${token.symbol}) on the Lithosphere Makalu network.`} />
      </Head>

      <div className="text-white space-y-6">
        {/* ── Breadcrumb ──────────────────────────────────────────────── */}
        <div className="flex items-center gap-2 text-sm text-white/40">
          <Link href="/" className="hover:text-white/70 transition">Home</Link>
          <span>/</span>
          <Link href="/tokens" className="hover:text-white/70 transition">Tokens</Link>
          <span>/</span>
          <span className="text-white/70">{token.symbol}</span>
        </div>

        {/* ── Token Header ────────────────────────────────────────────── */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-4">
          <div className="flex items-center gap-4">
            {isNative ? (
              <img src="/litho-logo.png" alt={token.symbol} className="w-14 h-14 rounded-full object-contain" />
            ) : (
              <div className="w-14 h-14 rounded-full bg-violet-500 flex items-center justify-center text-2xl font-bold text-white">
                {token.symbol.charAt(0).toUpperCase()}
              </div>
            )}
            <div>
              <div className="flex items-center gap-3 flex-wrap">
                <h1 className="text-3xl font-semibold">{token.name}</h1>
                {token.verified ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2.5 py-0.5 text-xs font-medium text-emerald-300">
                    <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" clipRule="evenodd" /></svg>
                    Verified
                  </span>
                ) : token.type !== 'native' && (
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-yellow-400/30 bg-yellow-400/10 px-2.5 py-0.5 text-xs font-medium text-yellow-300">
                    <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-8-5a.75.75 0 01.75.75v4.5a.75.75 0 01-1.5 0v-4.5A.75.75 0 0110 5zm0 10a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" /></svg>
                    Unverified
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3 mt-1">
                <span className="text-lg text-white/50">{token.symbol}</span>
                <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${
                  getAssetBadgeClasses(token)
                }`}>
                  {getAssetBadgeLabel(token)}
                </span>
              </div>
            </div>
          </div>

          {/* Contract address + add-to-wallet on header */}
          {token.contractAddress && (
            <div className="sm:ml-auto flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-2 bg-white/5 rounded-2xl border border-white/10 px-4 py-2">
                <span className="text-xs text-white/40">Contract:</span>
                <Link
                  href={`/address/${token.contractAddress}`}
                  className="font-mono text-sm text-emerald-300 hover:text-emerald-200 transition"
                >
                  {truncateHash(token.contractAddress, 10, 8)}
                </Link>
                <CopyBtn text={token.contractAddress} />
              </div>
              {!isNative && !isNft && (
                <AddToWalletBtn
                  address={token.contractAddress}
                  symbol={token.symbol}
                  decimals={decimals}
                />
              )}
            </div>
          )}
        </div>

        {/* ── Overview Stats ──────────────────────────────────────────── */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-3xl border border-white/10 bg-white/5 p-5">
            <div className="text-sm text-white/45 mb-1">Total Supply</div>
            <div className="text-xl font-semibold font-mono">
              {formatSupplyValue(token.totalSupply, decimals)}
            </div>
            <div className="text-xs text-white/30 mt-1">{token.symbol}</div>
          </div>
          <div className="rounded-3xl border border-white/10 bg-white/5 p-5">
            <div className="text-sm text-white/45 mb-1">Holders</div>
            <div className="text-xl font-semibold">
              {formatCount(token.holders)}
            </div>
            <div className="text-xs text-white/30 mt-1">{token.holders == null ? 'pending index' : 'addresses'}</div>
          </div>
          <div className="rounded-3xl border border-white/10 bg-white/5 p-5">
            <div className="text-sm text-white/45 mb-1">Transfers</div>
            <div className="text-xl font-semibold">
              {formatCount(token.transfers)}
            </div>
            <div className="text-xs text-white/30 mt-1">{token.transfers == null ? 'pending index' : 'total'}</div>
          </div>
          <div className="rounded-3xl border border-white/10 bg-white/5 p-5">
            <div className="text-sm text-white/45 mb-1">Standard</div>
            <div className="text-xl font-semibold">{getAssetStandard(token)}</div>
            <div className="text-xs text-white/30 mt-1">{decimals} decimals</div>
          </div>
        </div>

        {/* ── Token Info Card ─────────────────────────────────────────── */}
        <div className="rounded-3xl border border-white/10 bg-white/5 px-6 py-2">
          {token.contractAddress && (
            <div className="flex flex-col sm:flex-row sm:items-start gap-1 sm:gap-4 py-4 border-b border-white/5">
              <div className="sm:w-44 shrink-0 text-sm text-white/45">Contract</div>
              <div className="flex-1 text-sm font-mono break-all">
                <Link href={`/address/${token.contractAddress}`} className="text-emerald-300 hover:text-emerald-200 transition">
                  {token.contractAddress}
                </Link>
                <CopyBtn text={token.contractAddress} />
              </div>
            </div>
          )}
          {token.creator && (
            <div className="flex flex-col sm:flex-row sm:items-start gap-1 sm:gap-4 py-4 border-b border-white/5">
              <div className="sm:w-44 shrink-0 text-sm text-white/45">Creator</div>
              <div className="flex-1 text-sm font-mono">
                <Link href={`/address/${token.creator}`} className="text-emerald-300 hover:text-emerald-200 transition break-all">
                  {token.creator}
                </Link>
              </div>
            </div>
          )}
          {hasCreationTx && (
            <div className="flex flex-col sm:flex-row sm:items-start gap-1 sm:gap-4 py-4 border-b border-white/5">
              <div className="sm:w-44 shrink-0 text-sm text-white/45">Creation Tx</div>
              <div className="flex-1 text-sm font-mono">
                {creationTxHash ? (
                  <Link href={`/txs/${creationTxHash}`} className="text-emerald-300 hover:text-emerald-200 transition break-all">
                    {truncateHash(creationTxHash)}
                  </Link>
                ) : (
                  <span className="text-white/30">Unavailable</span>
                )}
              </div>
            </div>
          )}
          {token.creationBlock != null && (
            <div className="flex flex-col sm:flex-row sm:items-start gap-1 sm:gap-4 py-4 border-b border-white/5">
              <div className="sm:w-44 shrink-0 text-sm text-white/45">Creation Block</div>
              <div className="flex-1 text-sm font-mono">
                <Link href={`/blocks/${token.creationBlock}`} className="text-emerald-300 hover:text-emerald-200 transition">
                  #{formatNumber(token.creationBlock)}
                </Link>
              </div>
            </div>
          )}
          <div className="flex flex-col sm:flex-row sm:items-start gap-1 sm:gap-4 py-4 border-b border-white/5">
            <div className="sm:w-44 shrink-0 text-sm text-white/45">Decimals</div>
            <div className="flex-1 text-sm font-mono text-white">{decimals}</div>
          </div>
          {token.createdAt && (
            <div className="flex flex-col sm:flex-row sm:items-start gap-1 sm:gap-4 py-4 border-b border-white/5">
              <div className="sm:w-44 shrink-0 text-sm text-white/45">Created</div>
              <div className="flex-1 text-sm text-white/70">
                {formatTimestamp(token.createdAt)}
                <span className="ml-2 text-white/40">({timeAgo(token.createdAt)})</span>
              </div>
            </div>
          )}
          {token.description && (
            <div className="flex flex-col sm:flex-row sm:items-start gap-1 sm:gap-4 py-4">
              <div className="sm:w-44 shrink-0 text-sm text-white/45">Description</div>
              <div className="flex-1 text-sm text-white/70 leading-relaxed">{token.description}</div>
            </div>
          )}
          {!token.contractAddress && !token.creator && !hasCreationTx && !token.description && (
            <div className="flex flex-col sm:flex-row sm:items-start gap-1 sm:gap-4 py-4">
              <div className="sm:w-44 shrink-0 text-sm text-white/45">Type</div>
              <div className="flex-1 text-sm text-white">{getAssetTypeLabel(token)}</div>
            </div>
          )}
        </div>

        {/* ── Tab Bar ─────────────────────────────────────────────────── */}
        <div className="border-b border-white/10">
          <div className="overflow-x-auto">
            <nav className="flex w-max min-w-full gap-6 -mb-px" aria-label="Token tabs">
              {TABS.map((t) => {
                const active = activeTab === t.key;
                return (
                  <button
                    key={t.key}
                    onClick={() => setTab(t.key)}
                    className={`pb-3 text-sm font-medium transition border-b-2 ${
                      active
                        ? 'border-emerald-400 text-white'
                        : 'border-transparent text-white/50 hover:text-white/70'
                    }`}
                  >
                    {t.label}
                    {t.key === 'transfers' && (token.transfers ?? 0) > 0 && (
                      <span className="ml-1.5 text-xs text-white/35">({formatNumber(token.transfers)})</span>
                    )}
                    {t.key === 'holders' && (token.holders ?? 0) > 0 && (
                      <span className="ml-1.5 text-xs text-white/35">({formatNumber(token.holders)})</span>
                    )}
                  </button>
                );
              })}
            </nav>
          </div>
        </div>

        {/* ── Tab Content ─────────────────────────────────────────────── */}
        <div className="rounded-3xl border border-white/10 bg-white/5 overflow-hidden">
          {activeTab === 'transfers' && (
            <TransfersTab address={address} decimals={decimals} symbol={token.symbol} isNft={isNft} />
          )}

          {activeTab === 'holders' && (
            <HoldersTab address={address} decimals={decimals} symbol={token.symbol} totalSupply={token.totalSupply} />
          )}

          {activeTab === 'contract' && (
            <ContractTab token={token} />
          )}

          {activeTab === 'info' && (
            <InfoTab token={token} />
          )}
        </div>
      </div>
    </>
  );
}
