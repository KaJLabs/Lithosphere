import { useState, useCallback, useEffect } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useApi } from '@/lib/api';
import { EXPLORER_TITLE } from '@/lib/constants';
import { formatNumber, formatSupply, truncateHash, timeAgo, formatTimestamp, formatLitho, formatValue } from '@/lib/format';
import { getPreferredTxHash, isValidTransactionHash } from '@/lib/tx';
import type { ApiAddress, ApiTx, ApiTokenDetail, ApiTokenHolderList, ApiPrice, ApiAddressTxList, PageInfo, ApiAddressToken, ApiAddressTokenTransferList, ApiTokenTransferList } from '@/lib/types';
import { FormattedValueElement } from '@/components/FormattedValueElement';

/* ── Tabs ─────────────────────────────────────────────────────────────── */

const WALLET_TABS = [
  { key: 'transactions', label: 'Transactions' },
  { key: 'transfers', label: 'Token Transfers (LEP-100)' },
  { key: 'tokens', label: 'Tokens' },
] as const;

const TOKEN_TABS = [
  { key: 'transfers', label: 'Transfers' },
  { key: 'holders', label: 'Holders' },
  { key: 'contract', label: 'Contract' },
  { key: 'interact', label: 'Interact' },
] as const;

type WalletTabKey = (typeof WALLET_TABS)[number]['key'];
type TokenTabKey = (typeof TOKEN_TABS)[number]['key'];
type TabKey = WalletTabKey | TokenTabKey;
const ADDRESS_TX_PAGE_SIZE = 25;
const ADDRESS_TX_GRID_CLASS = 'lg:grid-cols-[minmax(0,1.8fr)_minmax(0,0.85fr)_minmax(0,1.35fr)_minmax(0,1.35fr)_minmax(0,1fr)_minmax(0,0.85fr)_minmax(0,0.8fr)]';

function isNftTokenDetail(tokenDetail: ApiTokenDetail | null | undefined): boolean {
  return tokenDetail?.type === 'LEP100-6';
}

function getTokenStandardLabel(tokenDetail: ApiTokenDetail | null | undefined): string {
  if (tokenDetail?.standard) return tokenDetail.standard;
  return isNftTokenDetail(tokenDetail) ? 'LEP100-6' : 'LEP-100';
}

function getTokenTypeLabel(tokenDetail: ApiTokenDetail | null | undefined): string {
  return isNftTokenDetail(tokenDetail) ? 'LEP100-6 Collection' : 'LEP-100 Token';
}

function formatOptionalSupply(raw: string | null | undefined, decimals: number): string {
  return raw ? formatSupply(raw, decimals) : '--';
}

/* ── Standard LEP-100 ABI (ERC-20 compatible) ────────────────────────── */

const LEP100_ABI = [
  { name: 'name', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
  { name: 'symbol', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
  { name: 'decimals', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint8' }] },
  { name: 'totalSupply', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { name: 'balanceOf', type: 'function', stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { name: 'transfer', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'to', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ type: 'bool' }] },
  { name: 'allowance', type: 'function', stateMutability: 'view', inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { name: 'approve', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }], outputs: [{ type: 'bool' }] },
  { name: 'transferFrom', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'from', type: 'address' }, { name: 'to', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ type: 'bool' }] },
  { name: 'Transfer', type: 'event', inputs: [{ name: 'from', type: 'address', indexed: true }, { name: 'to', type: 'address', indexed: true }, { name: 'value', type: 'uint256', indexed: false }] },
  { name: 'Approval', type: 'event', inputs: [{ name: 'owner', type: 'address', indexed: true }, { name: 'spender', type: 'address', indexed: true }, { name: 'value', type: 'uint256', indexed: false }] },
];

/* ── Address type detection ──────────────────────────────────────────── */

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

/** Recognize a syntactically valid address even if the indexer hasn't seen it. */
function isPlausibleAddress(addr: string): boolean {
  if (!addr) return false;
  if (/^0x[0-9a-fA-F]{40}$/.test(addr)) return true;
  if (/^litho1[023456789acdefghjklmnpqrstuvwxyz]{38,}$/.test(addr)) return true;
  return false;
}

/** Build a zero-activity stub so a syntactically valid address still renders
 *  a normal page (zero balance, empty tabs) instead of a 404 error. */
function buildStubAddress(addr: string): ApiAddress {
  return {
    address: addr,
    evmAddress: /^0x/.test(addr) ? addr.toLowerCase() : undefined,
    balance: '0',
    balanceSource: 'indexed',
    txCount: 0,
    lastSeen: '',
    isContract: false,
    isToken: false,
  };
}

function detectIsContract(account: ApiAddress): boolean {
  return account.isContract === true;
}

function hasDisplayBalance(
  balance: string,
  balanceSource: ApiAddress['balanceSource'] | undefined,
): boolean {
  return balanceSource !== 'unavailable' && !!balance && balance !== '0';
}

function formatAddressBalance(
  balance: string,
  balanceSource: ApiAddress['balanceSource'] | undefined,
): string {
  if (balanceSource === 'unavailable') return 'Unavailable';
  return hasDisplayBalance(balance, balanceSource) ? formatLitho(balance) : '0 LITHO';
}

function BalanceSourceStatus({
  balanceSource,
}: {
  balanceSource: ApiAddress['balanceSource'] | undefined;
}) {
  if (balanceSource === 'indexed') {
    return (
      <div className="mt-2">
        <span className="inline-flex items-center rounded-full border border-amber-300/20 bg-amber-300/10 px-2.5 py-1 text-[11px] font-medium text-amber-100">
          Indexed fallback
        </span>
        <div className="mt-2 text-xs text-white/35">
          Live RPC was unavailable for this address, so this balance may lag wallet state.
        </div>
      </div>
    );
  }

  if (balanceSource === 'unavailable') {
    return (
      <div className="mt-2">
        <span className="inline-flex items-center rounded-full border border-amber-300/20 bg-amber-300/10 px-2.5 py-1 text-[11px] font-medium text-amber-100">
          Live RPC unavailable
        </span>
        <div className="mt-2 text-xs text-white/35">
          The explorer could not resolve a current native balance for this address.
        </div>
      </div>
    );
  }

  return null;
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

function StatusDot({ success }: { success: boolean }) {
  return (
    <span
      className={`inline-flex h-2 w-2 rounded-full shrink-0 ${success ? 'bg-emerald-400' : 'bg-red-400'}`}
      title={success ? 'Success' : 'Failed'}
    />
  );
}

/* ── Skeleton loaders ─────────────────────────────────────────────────── */

function PageSkeleton() {
  return (
    <div className="text-white animate-pulse space-y-6">
      <div className="space-y-3">
        <div className="h-5 rounded bg-white/10 w-24" />
        <div className="h-8 rounded-xl bg-white/10 w-2/3" />
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="rounded-3xl border border-white/10 bg-white/5 p-5 space-y-3">
            <div className="h-3 rounded bg-white/10 w-20" />
            <div className="h-6 rounded bg-white/10 w-28" />
          </div>
        ))}
      </div>
      <div className="rounded-3xl border border-white/10 bg-white/5 p-5 space-y-3">
        <div className="h-4 rounded bg-white/10 w-24" />
        <div className="h-10 rounded bg-white/10 w-full" />
      </div>
      <div className="flex gap-6 border-b border-white/10 pb-0">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-4 rounded bg-white/10 w-24 mb-3" />
        ))}
      </div>
      <div className="rounded-3xl border border-white/10 bg-white/5 p-4 space-y-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex gap-4">
            <div className="h-4 rounded bg-white/10 w-1/3" />
            <div className="h-4 rounded bg-white/10 w-1/4" />
            <div className="h-4 rounded bg-white/10 w-1/4" />
          </div>
        ))}
      </div>
    </div>
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

/* ── Transaction table (shared between Transactions & Transfers tabs) ── */

function TxTable({
  txs,
  loading,
  currentAddrs,
  emptyLabel,
  pageInfo,
  onPageChange,
}: {
  txs: ApiTx[] | null;
  loading: boolean;
  currentAddrs: string[];
  emptyLabel: string;
  pageInfo?: PageInfo | null;
  onPageChange?: (offset: number) => void;
}) {
  const currentAddrSet = new Set(currentAddrs.map((addr) => addr.toLowerCase()));
  const isCurrentAddress = (...addresses: Array<string | null | undefined>) =>
    addresses.some((addr) => !!addr && currentAddrSet.has(addr.toLowerCase()));
  const total = pageInfo?.total ?? txs?.length ?? 0;
  const offset = pageInfo?.offset ?? 0;
  const limit = pageInfo?.limit ?? txs?.length ?? ADDRESS_TX_PAGE_SIZE;
  const totalPages = Math.max(1, Math.ceil(total / Math.max(limit, 1)));

  if (loading && (!txs || txs.length === 0)) return <TableSkeleton />;

  if (!txs || txs.length === 0) {
    return (
      <div className="py-16 text-center text-white/40">
        <div className="text-base font-medium mb-1">{emptyLabel}</div>
        <div className="text-sm">This address has no indexed activity yet.</div>
      </div>
    );
  }

  return (
    <>
      {pageInfo && total > 0 && (
        <div className="flex flex-col gap-1 border-b border-white/10 px-5 py-3 text-xs text-white/40 sm:flex-row sm:items-center sm:justify-between">
          <div>{formatNumber(total)} matching transaction{total === 1 ? '' : 's'}</div>
          <div>
            Showing {formatNumber(offset + 1)} to {formatNumber(Math.min(offset + txs.length, total))}
          </div>
        </div>
      )}
      <div className="overflow-x-auto">
        <div className="min-w-0">
          <div className={`hidden lg:grid ${ADDRESS_TX_GRID_CLASS} gap-4 border-b border-white/10 px-5 py-3 text-[11px] font-medium uppercase tracking-[0.24em] text-white/40`}>
            <div>Tx Hash</div>
            <div>Block</div>
            <div>From</div>
            <div>To</div>
            <div>Value</div>
            <div>Method</div>
            <div className="text-right">Age</div>
          </div>
          <div>
            {txs.map((tx) => {
              const methodLabel = tx.methodName ?? (tx.txType === 'call' ? 'Call' : tx.txType === 'create' ? 'Create' : 'Transfer');
              const txHash = getPreferredTxHash(tx);
              const txKey = txHash ?? `${tx.blockHeight}-${tx.fromAddr}-${tx.toAddr ?? 'none'}-${tx.timestamp ?? 'unknown'}`;
              return (
                <div
                  key={txKey}
                  className={`grid grid-cols-1 ${ADDRESS_TX_GRID_CLASS} gap-3 border-b border-white/5 px-5 py-4 transition hover:bg-white/[0.03] lg:gap-4`}
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
                    <Link href={`/blocks/${tx.blockHeight}`} className="font-mono text-sm text-white/80 transition hover:text-white">
                      #{formatNumber(tx.blockHeight)}
                    </Link>
                  </div>
                  <div className="flex min-w-0 items-center lg:block">
                    <span className="mr-2 w-16 shrink-0 text-xs text-white/40 lg:hidden">From</span>
                    <Link
                      href={`/address/${tx.fromAddr}`}
                      className={`block truncate font-mono text-sm transition ${isCurrentAddress(tx.fromAddr, tx.evmFromAddr, tx.cosmosFromAddr) ? 'text-white/50' : 'text-emerald-300 hover:text-emerald-200'}`}
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
                        className={`block truncate font-mono text-sm transition ${isCurrentAddress(tx.toAddr, tx.evmToAddr, tx.cosmosToAddr) ? 'text-white/50' : 'text-emerald-300 hover:text-emerald-200'}`}
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
                      <FormattedValueElement
                        formattedStr={formatValue(tx.value, tx.denom)}
                        tokenAddress={tx.contractAddress}
                      />
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
        </div>
      </div>
      {pageInfo && totalPages > 1 && onPageChange && (
        <div className="flex flex-col gap-3 border-t border-white/10 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-xs text-white/35">
            Page {formatNumber(Math.floor(offset / limit) + 1)} of {formatNumber(totalPages)}
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => onPageChange(Math.max(0, offset - limit))}
              disabled={offset === 0}
              className="rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/70 hover:bg-white/10 transition disabled:opacity-30 disabled:cursor-not-allowed"
            >
              Previous
            </button>
            <button
              onClick={() => onPageChange(offset + limit)}
              disabled={!pageInfo.hasMore}
              className="rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/70 hover:bg-white/10 transition disabled:opacity-30 disabled:cursor-not-allowed"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </>
  );
}

/* ── Holdings table ──────────────────────────────────────────────────── */

function HoldingsSection({
  balance,
  balanceSource,
  usdPrice,
}: {
  balance: string;
  balanceSource: ApiAddress['balanceSource'];
  usdPrice: number | null;
}) {
  const hasBalance = hasDisplayBalance(balance, balanceSource);
  let usdValue: string | null = null;
  if (balanceSource === 'rpc' && hasBalance && usdPrice != null) {
    try {
      const raw = BigInt(balance);
      const lithoAmount = Number(raw) / 1e18;
      const usd = lithoAmount * usdPrice;
      usdValue = usd.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
    } catch { /* ignore */ }
  }

  return (
    <div className="rounded-3xl border border-white/10 bg-white/5 overflow-hidden">
      <div className="px-5 py-4 border-b border-white/10">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-medium text-white/70 uppercase tracking-wide">Holdings</h2>
          {balanceSource === 'indexed' && (
            <span className="inline-flex items-center rounded-full border border-amber-300/20 bg-amber-300/10 px-2.5 py-1 text-[11px] font-medium text-amber-100">
              Indexed fallback
            </span>
          )}
          {balanceSource === 'unavailable' && (
            <span className="inline-flex items-center rounded-full border border-amber-300/20 bg-amber-300/10 px-2.5 py-1 text-[11px] font-medium text-amber-100">
              Live RPC unavailable
            </span>
          )}
        </div>
      </div>
      {balanceSource === 'unavailable' ? (
        <div className="py-10 text-center text-white/40">
          <div className="text-sm text-white/65">Native balance unavailable</div>
          <div className="mt-1 text-xs text-white/35">
            Explorer could not reach live RPC for this address.
          </div>
        </div>
      ) : hasBalance ? (
        <>
          <div className="grid grid-cols-[1.2fr_1.6fr_1fr] sm:grid-cols-[1fr_0.6fr_1.4fr_1fr] gap-2 sm:gap-4 px-5 py-3 border-b border-white/10 text-xs font-medium text-white/40 uppercase tracking-wide">
            <div>Name</div>
            <div className="hidden sm:block">Ticker</div>
            <div className="text-right">Amount</div>
            <div className="text-right">Value (USD)</div>
          </div>
          <div className="grid grid-cols-[1.2fr_1.6fr_1fr] sm:grid-cols-[1fr_0.6fr_1.4fr_1fr] gap-2 sm:gap-4 px-5 py-4 hover:bg-white/[0.03] transition">
            <div className="flex items-center gap-2 text-sm text-white min-w-0">
              <img src="/litho-logo.png" alt="LITHO" className="w-5 h-5 rounded-full object-contain shrink-0" />
              <span className="truncate">Lithosphere</span>
            </div>
            <div className="hidden sm:block text-sm text-white/70 font-mono truncate">LITHO</div>
            <div className="text-sm text-white/80 font-mono text-right truncate">{formatLitho(balance)}</div>
            <div className="text-sm text-white/60 font-mono text-right truncate">{usdValue ?? '--'}</div>
          </div>
        </>
      ) : (
        <div className="py-10 text-center text-white/40">
          <div className="text-sm">No holdings found</div>
        </div>
      )}
    </div>
  );
}

/* ── Token Transfers tab (wallet) — LEP-100 transfer events ─────────── */

const TOKEN_TRANSFER_PAGE_SIZE = 25;

function TokenTransfersTab({ addr, currentAddrs }: { addr: string; currentAddrs: string[] }) {
  const [page, setPage] = useState(0);
  const offset = page * TOKEN_TRANSFER_PAGE_SIZE;
  const currentAddrSet = new Set(currentAddrs.map((a) => a.toLowerCase()));

  const { data, loading } = useApi<ApiAddressTokenTransferList>(
    addr ? `/address/${addr}/token-transfers?limit=${TOKEN_TRANSFER_PAGE_SIZE}&offset=${offset}` : null
  );

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / TOKEN_TRANSFER_PAGE_SIZE));

  if (loading && items.length === 0) return <TableSkeleton />;

  if (items.length === 0) {
    return (
      <div className="py-16 text-center text-white/40">
        <div className="text-base font-medium mb-1">No token transfers found</div>
        <div className="text-sm">No LEP-100 token transfer events for this address.</div>
      </div>
    );
  }

  return (
    <>
      <div className="flex flex-col gap-1 border-b border-white/10 px-5 py-3 text-xs text-white/40 sm:flex-row sm:items-center sm:justify-between">
        <div>{formatNumber(total)} transfer{total !== 1 ? 's' : ''} found</div>
        <div>Showing {formatNumber(offset + 1)} to {formatNumber(Math.min(offset + items.length, total))}</div>
      </div>
      <div className="overflow-x-auto">
        <div className="hidden lg:grid grid-cols-[minmax(0,1.6fr)_minmax(0,0.7fr)_minmax(0,1.4fr)_minmax(0,1.4fr)_minmax(0,1.5fr)_minmax(0,0.8fr)] gap-4 px-5 py-3 border-b border-white/10 text-[11px] font-medium uppercase tracking-[0.24em] text-white/40">
          <div>Tx Hash</div>
          <div>Block</div>
          <div>From</div>
          <div>To</div>
          <div className="text-right">Amount</div>
          <div className="text-right">Age</div>
        </div>
        {items.map((t, i) => {
          const isFrom = currentAddrSet.has(t.fromAddress?.toLowerCase());
          return (
            <div
              key={`${t.txHash}-${i}`}
              className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,0.7fr)_minmax(0,1.4fr)_minmax(0,1.4fr)_minmax(0,1.5fr)_minmax(0,0.8fr)] gap-3 lg:gap-4 px-5 py-4 border-b border-white/5 hover:bg-white/[0.03] transition"
            >
              <div className="flex items-center gap-2 min-w-0">
                <Link href={`/txs/${t.txHash}`} className="block truncate font-mono text-sm text-emerald-300 hover:text-emerald-200 transition" title={t.txHash}>
                  {truncateHash(t.txHash)}
                </Link>
              </div>
              <div className="flex items-center">
                <Link href={`/blocks/${t.blockHeight}`} className="font-mono text-sm text-white/80 hover:text-white transition">
                  #{formatNumber(Number(t.blockHeight))}
                </Link>
              </div>
              <div className="flex items-center min-w-0">
                <span className="mr-2 w-16 shrink-0 text-xs text-white/40 lg:hidden">From</span>
                {currentAddrSet.has(t.fromAddress?.toLowerCase()) ? (
                  <span className="block truncate font-mono text-sm text-white/40" title={t.fromAddress}>{truncateHash(t.fromAddress, 8, 6)}</span>
                ) : (
                  <Link href={`/address/${t.fromAddress}`} className="block truncate font-mono text-sm text-emerald-300 hover:text-emerald-200 transition" title={t.fromAddress}>
                    {truncateHash(t.fromAddress, 8, 6)}
                  </Link>
                )}
              </div>
              <div className="flex items-center min-w-0">
                <span className="mr-2 w-16 shrink-0 text-xs text-white/40 lg:hidden">To</span>
                {currentAddrSet.has(t.toAddress?.toLowerCase()) ? (
                  <span className="block truncate font-mono text-sm text-white/40" title={t.toAddress}>{truncateHash(t.toAddress, 8, 6)}</span>
                ) : (
                  <Link href={`/address/${t.toAddress}`} className="block truncate font-mono text-sm text-emerald-300 hover:text-emerald-200 transition" title={t.toAddress}>
                    {truncateHash(t.toAddress, 8, 6)}
                  </Link>
                )}
              </div>
              <div className="flex items-center justify-end gap-1.5 min-w-0">
                <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium ${isFrom ? 'bg-red-400/10 text-red-300 border border-red-400/20' : 'bg-emerald-400/10 text-emerald-300 border border-emerald-400/20'}`}>
                  {isFrom ? 'OUT' : 'IN'}
                </span>
                <span className="font-mono text-sm text-white/80 truncate">
                  {t.type === 'LEP100-6'
                    ? `#${t.tokenId ?? t.value}`
                    : formatSupply(t.value, t.decimals)}
                </span>
                <Link href={`/token/${t.contractAddress}`} className="shrink-0 rounded-full border border-white/15 bg-white/5 px-2 py-0.5 font-mono text-[10px] text-white/60 hover:text-emerald-300 transition">
                  {t.tokenSymbol}
                </Link>
              </div>
              <div className="flex items-center justify-end">
                <span className="text-sm text-white/50" title={t.timestamp ?? ''}>
                  {t.timestamp ? timeAgo(t.timestamp) : '--'}
                </span>
              </div>
            </div>
          );
        })}
      </div>
      {totalPages > 1 && (
        <div className="flex flex-col gap-3 border-t border-white/10 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-xs text-white/35">Page {page + 1} of {totalPages}</div>
          <div className="flex gap-2">
            <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0} className="rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/70 hover:bg-white/10 transition disabled:opacity-30 disabled:cursor-not-allowed">Previous</button>
            <button onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1} className="rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/70 hover:bg-white/10 transition disabled:opacity-30 disabled:cursor-not-allowed">Next</button>
          </div>
        </div>
      )}
    </>
  );
}

/* ── Tokens tab (wallet) — shows this address's actual token balances ── */

function TokensTab({ addr }: { addr: string }) {
  const { data: tokens, loading } = useApi<ApiAddressToken[]>(
    addr ? `/address/${addr}/tokens` : null
  );

  if (loading) return <TableSkeleton rows={4} />;

  if (!tokens || tokens.length === 0) {
    return (
      <div className="py-16 text-center text-white/40">
        <div className="text-base font-medium mb-1">No token balances</div>
        <div className="text-sm">No LEP-100 token holdings detected for this address.</div>
      </div>
    );
  }

  return (
    <>
      <div className="px-5 py-3 border-b border-white/10 text-xs text-white/40">
        {tokens.length} token{tokens.length !== 1 ? 's' : ''} held
      </div>
      <div className="hidden md:grid grid-cols-[2.5fr_1fr_1.8fr_1fr] gap-4 px-5 py-3 border-b border-white/10 text-xs font-medium text-white/40 uppercase tracking-wide">
        <div>Token</div>
        <div>Symbol</div>
        <div className="text-right">Balance</div>
        <div className="text-right">Type</div>
      </div>
      <div>
        {tokens.map((t) => (
          <Link
            key={t.contractAddress}
            href={`/token/${t.contractAddress}`}
            className="grid grid-cols-1 md:grid-cols-[2.5fr_1fr_1.8fr_1fr] gap-3 md:gap-4 px-5 py-4 border-b border-white/5 hover:bg-white/[0.03] transition"
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-7 h-7 rounded-full bg-violet-500/80 flex items-center justify-center text-xs font-bold text-white shrink-0">
                {t.symbol.charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0">
                <div className="text-sm text-white font-medium truncate">{t.name}</div>
                <div className="text-xs text-white/40 font-mono truncate">{truncateHash(t.contractAddress, 8, 6)}</div>
              </div>
            </div>
            <div className="flex items-center text-sm text-white/70 font-mono">{t.symbol}</div>
            <div className="flex items-center justify-end text-sm text-white/80 font-mono font-semibold">
              {t.type === 'LEP100-6'
                ? `${t.balance} NFT${Number(t.balance) !== 1 ? 's' : ''}`
                : formatSupply(t.balance, t.decimals)}
            </div>
            <div className="flex items-center justify-end">
              <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${
                t.type === 'LEP100-6'
                  ? 'border-amber-400/30 bg-amber-400/10 text-amber-300'
                  : 'border-violet-400/30 bg-violet-400/10 text-violet-300'
              }`}>
                {t.type === 'LEP100-6' ? 'LEP100-6' : 'LEP-100'}
              </span>
            </div>
          </Link>
        ))}
      </div>
    </>
  );
}

/* ── Holders tab (token contract) ──────────────────────────────────── */

function HoldersTab({ addr, tokenDetail }: { addr: string; tokenDetail?: ApiTokenDetail | null }) {
  const [page, setPage] = useState(0);
  const perPage = 25;
  const offset = page * perPage;
  const { data, loading } = useApi<ApiTokenHolderList>(
    `/tokens/${addr}/holders?limit=${perPage}&offset=${offset}`
  );

  const holders = data?.holders ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / perPage));

  if (loading && holders.length === 0) return <TableSkeleton />;

  if (holders.length === 0) {
    return (
      <div className="py-16 text-center text-white/40">
        <div className="text-base font-medium mb-1">No holders found</div>
        <div className="text-sm">No holder data is available for this token yet.</div>
      </div>
    );
  }

  return (
    <>
      <div className="px-5 py-3 border-b border-white/10 text-xs text-white/40">
        A total of {formatNumber(total)} holder{total !== 1 ? 's' : ''} found
      </div>
      <div className="hidden md:grid grid-cols-[0.4fr_2fr_1.2fr_0.8fr] gap-4 px-5 py-3 border-b border-white/10 text-xs font-medium text-white/40 uppercase tracking-wide">
        <div>Rank</div>
        <div>Address</div>
        <div className="text-right">Balance</div>
        <div className="text-right">Percentage</div>
      </div>
      <div>
        {holders.map((h, i) => (
          <div key={h.address} className="grid grid-cols-1 md:grid-cols-[0.4fr_2fr_1.2fr_0.8fr] gap-3 md:gap-4 px-5 py-4 border-b border-white/5 hover:bg-white/[0.03] transition">
            <div className="text-sm text-white/40">{offset + i + 1}</div>
            <div>
              <Link href={`/address/${h.address}`} className="font-mono text-sm text-emerald-300 hover:text-emerald-200 transition truncate">
                {h.address}
              </Link>
            </div>
            <div className="text-sm font-mono text-white/80 md:text-right">
              {formatSupply(h.balance, tokenDetail?.decimals ?? 18)}{tokenDetail?.symbol ? ` ${tokenDetail.symbol}` : ''}
            </div>
            <div className="flex items-center gap-2 md:justify-end">
              <div className="hidden md:block w-16 h-1.5 rounded-full bg-white/10 overflow-hidden">
                <div className="h-full rounded-full bg-emerald-400" style={{ width: `${Math.min(100, h.percentage)}%` }} />
              </div>
              <span className="text-sm text-white/60">{h.percentage.toFixed(2)}%</span>
            </div>
          </div>
        ))}
      </div>
      {totalPages > 1 && (
        <div className="flex items-center justify-between px-5 py-4 border-t border-white/10">
          <p className="text-xs text-white/30">Showing {offset + 1} to {Math.min(offset + perPage, total)} of {formatNumber(total)}</p>
          <div className="flex items-center gap-1">
            <button onClick={() => setPage(0)} disabled={page === 0} className="px-2.5 py-1.5 text-xs rounded-lg border border-white/10 text-white/60 hover:bg-white/5 disabled:opacity-30 disabled:cursor-not-allowed transition">First</button>
            <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0} className="px-2.5 py-1.5 text-xs rounded-lg border border-white/10 text-white/60 hover:bg-white/5 disabled:opacity-30 disabled:cursor-not-allowed transition">Prev</button>
            <span className="px-3 py-1.5 text-xs text-white/60">Page {page + 1} of {totalPages}</span>
            <button onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1} className="px-2.5 py-1.5 text-xs rounded-lg border border-white/10 text-white/60 hover:bg-white/5 disabled:opacity-30 disabled:cursor-not-allowed transition">Next</button>
            <button onClick={() => setPage(totalPages - 1)} disabled={page >= totalPages - 1} className="px-2.5 py-1.5 text-xs rounded-lg border border-white/10 text-white/60 hover:bg-white/5 disabled:opacity-30 disabled:cursor-not-allowed transition">Last</button>
          </div>
        </div>
      )}
    </>
  );
}

/* ── Contract tab (token contract) ─────────────────────────────────── */

function ContractTab({ addr, tokenDetail }: { addr: string; tokenDetail: ApiTokenDetail | null }) {
  const verified = tokenDetail?.verified ?? false;
  const isNft = isNftTokenDetail(tokenDetail);
  const rawCreationTx = typeof tokenDetail?.creationTx === 'string' ? tokenDetail.creationTx.trim() : '';
  const creationTxHash = isValidTransactionHash(rawCreationTx) ? rawCreationTx : null;
  const hasCreationTx = rawCreationTx.length > 0;

  return (
    <div className="p-6 space-y-6">
      {/* Verification badge */}
      <div className="flex items-center gap-3">
        <div className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium ${
          verified
            ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300'
            : 'border-yellow-400/30 bg-yellow-400/10 text-yellow-300'
        }`}>
          {verified ? (
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

      {/* Contract overview */}
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] overflow-hidden">
        <div className="px-5 py-3 border-b border-white/10 text-sm font-medium text-white/60">Contract Overview</div>
        <div className="divide-y divide-white/5">
          <div className="flex flex-col sm:flex-row sm:items-start gap-1 sm:gap-4 px-5 py-4 min-w-0">
            <div className="sm:w-44 shrink-0 text-sm text-white/45">Contract Address</div>
            <div className="flex-1 min-w-0 text-sm text-white font-mono break-all break-words">
              {addr}
              <span className="inline-block ml-2 align-middle">
                <CopyBtn text={addr} />
              </span>
            </div>
          </div>
          {tokenDetail?.creator && (
            <div className="flex flex-col sm:flex-row sm:items-start gap-1 sm:gap-4 px-5 py-4">
              <div className="sm:w-44 shrink-0 text-sm text-white/45">Creator</div>
              <div className="flex-1 text-sm">
                <Link href={`/address/${tokenDetail.creator}`} className="font-mono text-emerald-300 hover:text-emerald-200 transition break-all">
                  {tokenDetail.creator}
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
          <div className="flex flex-col sm:flex-row sm:items-start gap-1 sm:gap-4 px-5 py-4">
            <div className="sm:w-44 shrink-0 text-sm text-white/45">Token Standard</div>
            <div className="flex-1 text-sm text-white">{getTokenStandardLabel(tokenDetail)}</div>
          </div>
        </div>
      </div>

      {/* ABI */}
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] overflow-hidden">
        <div className="px-5 py-3 border-b border-white/10 text-sm font-medium text-white/60">
          {isNft ? 'Contract ABI' : 'Contract ABI (LEP-100 Standard)'}
        </div>
        <div className="p-5">
          {isNft ? (
            <div className="rounded-xl bg-black/30 border border-white/5 p-4 text-sm text-white/50">
              ABI preview in this explorer is currently wired for LEP-100 contracts. Use source verification or an external ABI tool for this LEP100-6 collection.
            </div>
          ) : (
            <pre className="rounded-xl bg-black/30 border border-white/5 p-4 font-mono text-xs text-white/60 overflow-auto max-h-80 whitespace-pre-wrap">
              {JSON.stringify(LEP100_ABI, null, 2)}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Interact tab (token contract) ─────────────────────────────────── */

function InteractTab({ addr, tokenDetail }: { addr: string; tokenDetail: ApiTokenDetail | null }) {
  if (isNftTokenDetail(tokenDetail)) {
    return (
      <div className="p-6">
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 text-sm text-white/60">
          Direct contract interaction in this explorer is only wired for LEP-100 contracts. Use an LEP100-6-aware wallet or contract console for this collection.
        </div>
      </div>
    );
  }

  const readFns = LEP100_ABI.filter((f) => f.type === 'function' && (f.stateMutability === 'view' || f.stateMutability === 'pure'));
  const writeFns = LEP100_ABI.filter((f) => f.type === 'function' && f.stateMutability !== 'view' && f.stateMutability !== 'pure');

  const tokenName = tokenDetail?.name ?? 'Token';
  const tokenSymbol = tokenDetail?.symbol ?? '???';
  const decimals = tokenDetail?.decimals ?? 18;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-2 text-sm text-white/50">
        Interact with <span className="font-semibold text-white">{tokenName} ({tokenSymbol})</span> LEP-100 contract
      </div>

      {/* Read functions */}
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] overflow-hidden">
        <div className="px-5 py-3 border-b border-white/10 flex items-center gap-2">
          <span className="inline-flex items-center rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2 py-0.5 text-xs font-medium text-emerald-300">Read</span>
          <span className="text-sm font-medium text-white/60">Contract Methods</span>
        </div>
        <div className="divide-y divide-white/5">
          {readFns.map((fn) => (
            <div key={fn.name} className="px-5 py-4">
              <div className="flex items-center gap-3 mb-2">
                <span className="font-mono text-sm text-white font-medium">{fn.name}</span>
                <span className="text-xs text-white/30">
                  ({fn.inputs?.map((inp: { name: string; type: string }) => `${inp.type} ${inp.name}`).join(', ')})
                </span>
                <span className="text-xs text-white/20">&rarr;</span>
                <span className="text-xs text-white/40">
                  {fn.outputs?.map((o: { type: string }) => o.type).join(', ')}
                </span>
              </div>
              {fn.inputs && fn.inputs.length > 0 ? (
                <div className="flex items-center gap-2">
                  {fn.inputs.map((inp: { name: string; type: string }) => (
                    <input
                      key={inp.name}
                      type="text"
                      placeholder={`${inp.name} (${inp.type})`}
                      className="flex-1 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/80 font-mono placeholder:text-white/20 focus:outline-none focus:border-emerald-400/50"
                      disabled
                    />
                  ))}
                  <button
                    disabled
                    className="rounded-lg border border-emerald-400/30 bg-emerald-400/10 px-4 py-2 text-sm font-medium text-emerald-300 opacity-50 cursor-not-allowed"
                  >
                    Query
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/40 font-mono flex-1">
                    {fn.name === 'name' && tokenName}
                    {fn.name === 'symbol' && tokenSymbol}
                    {fn.name === 'decimals' && String(decimals)}
                    {fn.name === 'totalSupply' && (tokenDetail?.totalSupply ? formatSupply(tokenDetail.totalSupply, decimals) + ` ${tokenSymbol}` : '--')}
                    {!['name', 'symbol', 'decimals', 'totalSupply'].includes(fn.name) && 'Connect wallet to query'}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Write functions */}
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] overflow-hidden">
        <div className="px-5 py-3 border-b border-white/10 flex items-center gap-2">
          <span className="inline-flex items-center rounded-full border border-amber-400/30 bg-amber-400/10 px-2 py-0.5 text-xs font-medium text-amber-300">Write</span>
          <span className="text-sm font-medium text-white/60">Contract Methods</span>
        </div>
        <div className="divide-y divide-white/5">
          {writeFns.map((fn) => (
            <div key={fn.name} className="px-5 py-4">
              <div className="flex items-center gap-3 mb-2">
                <span className="font-mono text-sm text-white font-medium">{fn.name}</span>
                <span className="text-xs text-white/30">
                  ({fn.inputs?.map((inp: { name: string; type: string }) => `${inp.type} ${inp.name}`).join(', ')})
                </span>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                {fn.inputs?.map((inp: { name: string; type: string }) => (
                  <input
                    key={inp.name}
                    type="text"
                    placeholder={`${inp.name} (${inp.type})`}
                    className="flex-1 min-w-[150px] rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/80 font-mono placeholder:text-white/20 focus:outline-none focus:border-amber-400/50"
                    disabled
                  />
                ))}
                <button
                  disabled
                  className="rounded-lg border border-amber-400/30 bg-amber-400/10 px-4 py-2 text-sm font-medium text-amber-300 opacity-50 cursor-not-allowed"
                >
                  Write
                </button>
              </div>
              <div className="mt-1 text-xs text-white/25">Connect wallet to execute</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ── Transfers tab (token contract) ─────────────────────────────────── */

function TokenContractTransfersTab({ addr, tokenDetail }: { addr: string; tokenDetail: ApiTokenDetail | null }) {
  const [page, setPage] = useState(0);
  const perPage = 25;
  const offset = page * perPage;

  const { data, loading } = useApi<ApiTokenTransferList>(
    addr ? `/tokens/${addr}/transfers?limit=${perPage}&offset=${offset}` : null
  );

  const transfers = data?.transfers ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  const isNft = isNftTokenDetail(tokenDetail);
  const symbol = tokenDetail?.symbol ?? '';
  const decimals = tokenDetail?.decimals ?? 18;

  if (loading && transfers.length === 0) return <TableSkeleton />;

  if (transfers.length === 0) {
    return (
      <div className="py-16 text-center text-white/40">
        <div className="text-base font-medium mb-1">No transfers found</div>
        <div className="text-sm">No transfer events recorded for this token yet.</div>
      </div>
    );
  }

  return (
    <>
      <div className="flex flex-col gap-1 border-b border-white/10 px-5 py-3 text-xs text-white/40 sm:flex-row sm:items-center sm:justify-between">
        <div>A total of {formatNumber(total)} transfer{total !== 1 ? 's' : ''} found</div>
        <div>Showing {formatNumber(offset + 1)} to {formatNumber(Math.min(offset + transfers.length, total))}</div>
      </div>
      <div className="overflow-x-auto">
        <div className="hidden lg:grid grid-cols-[minmax(0,1.6fr)_minmax(0,0.7fr)_minmax(0,1.4fr)_minmax(0,1.4fr)_minmax(0,1.4fr)_minmax(0,0.8fr)] gap-4 px-5 py-3 border-b border-white/10 text-[11px] font-medium uppercase tracking-[0.24em] text-white/40">
          <div>Tx Hash</div>
          <div>Block</div>
          <div>From</div>
          <div>To</div>
          <div className="text-right">Amount</div>
          <div className="text-right">Age</div>
        </div>
        {transfers.map((t, i) => (
          <div
            key={`${t.txHash}-${i}`}
            className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,0.7fr)_minmax(0,1.4fr)_minmax(0,1.4fr)_minmax(0,1.4fr)_minmax(0,0.8fr)] gap-3 lg:gap-4 px-5 py-4 border-b border-white/5 hover:bg-white/[0.03] transition"
          >
            <div className="flex items-center gap-2 min-w-0">
              <Link href={`/txs/${t.txHash}`} className="block truncate font-mono text-sm text-emerald-300 hover:text-emerald-200 transition" title={t.txHash}>
                {truncateHash(t.txHash)}
              </Link>
            </div>
            <div className="flex items-center">
              <Link href={`/blocks/${t.blockHeight}`} className="font-mono text-sm text-white/80 hover:text-white transition">
                #{formatNumber(t.blockHeight)}
              </Link>
            </div>
            <div className="flex items-center min-w-0">
              <span className="mr-2 w-16 shrink-0 text-xs text-white/40 lg:hidden">From</span>
              <Link href={`/address/${t.fromAddress}`} className="block truncate font-mono text-sm text-emerald-300 hover:text-emerald-200 transition" title={t.fromAddress}>
                {truncateHash(t.fromAddress, 8, 6)}
              </Link>
            </div>
            <div className="flex items-center min-w-0">
              <span className="mr-2 w-16 shrink-0 text-xs text-white/40 lg:hidden">To</span>
              <Link href={`/address/${t.toAddress}`} className="block truncate font-mono text-sm text-emerald-300 hover:text-emerald-200 transition" title={t.toAddress}>
                {truncateHash(t.toAddress, 8, 6)}
              </Link>
            </div>
            <div className="flex items-center justify-end gap-1.5 min-w-0">
              <span className="font-mono text-sm text-white/80 truncate">
                {isNft
                  ? `#${t.tokenId ?? t.value}`
                  : formatSupply(t.value, decimals)}
              </span>
              {symbol && !isNft && (
                <span className="shrink-0 rounded-full border border-white/15 bg-white/5 px-2 py-0.5 font-mono text-[10px] text-white/60">
                  {symbol}
                </span>
              )}
            </div>
            <div className="flex items-center justify-end">
              <span className="text-sm text-white/50" title={t.timestamp ?? ''}>
                {t.timestamp ? timeAgo(t.timestamp) : '--'}
              </span>
            </div>
          </div>
        ))}
      </div>
      {totalPages > 1 && (
        <div className="flex flex-col gap-3 border-t border-white/10 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-xs text-white/35">Page {page + 1} of {totalPages}</div>
          <div className="flex gap-2">
            <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0} className="rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/70 hover:bg-white/10 transition disabled:opacity-30 disabled:cursor-not-allowed">Previous</button>
            <button onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1} className="rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/70 hover:bg-white/10 transition disabled:opacity-30 disabled:cursor-not-allowed">Next</button>
          </div>
        </div>
      )}
    </>
  );
}

/* ── Token contract layout ───────────────────────────────────────────── */

function TokenContractLayout({
  account,
  tokenDetail,
  addr,
  activeTab,
  setTab,
}: {
  account: ApiAddress;
  tokenDetail: ApiTokenDetail | null;
  addr: string;
  activeTab: TabKey;
  setTab: (key: TabKey) => void;
}) {
  const tokenName = tokenDetail?.name ?? account.tokenName ?? 'Unknown Token';
  const tokenSymbol = tokenDetail?.symbol ?? account.tokenSymbol ?? '???';
  const isToken = account.isToken || !!tokenDetail;
  const isNft = isNftTokenDetail(tokenDetail);
  const decimals = tokenDetail?.decimals ?? account.tokenDecimals ?? 18;
  const totalSupply = tokenDetail?.totalSupply ?? account.totalSupply;
  const visibleTokenTabs = isNft ? TOKEN_TABS.filter((tab) => tab.key !== 'interact') : TOKEN_TABS;
  const resolvedTab = visibleTokenTabs.some((t) => t.key === activeTab) ? activeTab : 'transfers';

  return (
    <div className="text-white space-y-6">
      {/* ── Header ──────────────────────────────────────────────────── */}
      <div>
        <div className="flex items-center gap-2 text-sm text-white/40 mb-4">
          <Link href="/" className="hover:text-white/70 transition">Home</Link>
          <span>/</span>
          {isToken && (
            <>
              <Link href="/tokens" className="hover:text-white/70 transition">Tokens</Link>
              <span>/</span>
            </>
          )}
          <span className="text-white/70">{isToken ? 'Token' : 'Contract'}</span>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-2">
          {isToken && (
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-violet-500 flex items-center justify-center text-lg font-bold text-white">
                {tokenSymbol.charAt(0).toUpperCase()}
              </div>
              <div>
                <h1 className="text-2xl font-semibold">{tokenName}</h1>
                <span className="text-sm text-white/50">{tokenSymbol}</span>
              </div>
            </div>
          )}
          {!isToken && (
            <h1 className="text-2xl font-semibold break-all">
              <span className="font-mono">{account.address}</span>
            </h1>
          )}
          <div className="flex items-center gap-2 shrink-0">
            <CopyBtn text={account.address} />
            <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${
              isToken
                ? (isNft
                  ? 'border-amber-400/30 bg-amber-400/10 text-amber-300'
                  : 'border-violet-400/30 bg-violet-400/10 text-violet-300')
                : 'border-blue-400/30 bg-blue-400/10 text-blue-300'
            }`}>
              {isToken ? getTokenTypeLabel(tokenDetail) : 'Contract'}
            </span>
          </div>
        </div>

        {isToken && (
          <div className="font-mono text-sm text-white/40 break-all">{account.address}</div>
        )}
      </div>

      {/* ── Token overview cards ─────────────────────────────────────── */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-3xl border border-white/10 bg-white/5 p-5">
          <div className="text-sm text-white/45 mb-1">Total Supply</div>
          <div className="text-xl font-semibold font-mono">
            {formatOptionalSupply(totalSupply, decimals)}
          </div>
          {isToken && <div className="text-xs text-white/30 mt-1">{tokenSymbol}</div>}
        </div>
        <div className="rounded-3xl border border-white/10 bg-white/5 p-5">
          <div className="text-sm text-white/45 mb-1">Holders</div>
          <div className="text-xl font-semibold">
            {tokenDetail?.holders != null ? formatNumber(tokenDetail.holders) : '--'}
          </div>
        </div>
        <div className="rounded-3xl border border-white/10 bg-white/5 p-5">
          <div className="text-sm text-white/45 mb-1">Transfers</div>
          <div className="text-xl font-semibold">
            {tokenDetail?.transfers != null ? formatNumber(tokenDetail.transfers) : formatNumber(account.txCount)}
          </div>
        </div>
        <div className="rounded-3xl border border-white/10 bg-white/5 p-5">
          <div className="text-sm text-white/45 mb-1">Decimals</div>
          <div className="text-xl font-semibold">{decimals}</div>
        </div>
      </div>

      <div className="rounded-3xl border border-white/10 bg-white/5 px-6 py-2">
        <div className="flex flex-col sm:flex-row sm:items-start gap-1 sm:gap-4 py-4 border-b border-white/5 min-w-0">
          <div className="sm:w-40 shrink-0 text-sm text-white/45">Contract Address</div>
          <div className="flex-1 min-w-0 text-sm text-white font-mono break-all break-words">
            {account.address}
            <span className="inline-block ml-2 align-middle">
              <CopyBtn text={account.address} />
            </span>
          </div>
        </div>
        {tokenDetail?.creator && (
          <div className="flex flex-col sm:flex-row sm:items-start gap-1 sm:gap-4 py-4 border-b border-white/5">
            <div className="sm:w-40 shrink-0 text-sm text-white/45">Creator</div>
            <div className="flex-1 text-sm">
              <Link href={`/address/${tokenDetail.creator}`} className="font-mono text-emerald-300 hover:text-emerald-200 transition break-all">
                {tokenDetail.creator}
              </Link>
            </div>
          </div>
        )}
        {tokenDetail?.createdAt && (
          <div className="flex flex-col sm:flex-row sm:items-start gap-1 sm:gap-4 py-4">
            <div className="sm:w-40 shrink-0 text-sm text-white/45">Created</div>
            <div className="flex-1 text-sm text-white/70">
              {formatTimestamp(tokenDetail.createdAt)}
              <span className="ml-2 text-white/40">({timeAgo(tokenDetail.createdAt)})</span>
            </div>
          </div>
        )}
      </div>

      {/* ── Tab bar ─────────────────────────────────────────────────── */}
      <div className="border-b border-white/10">
        <div className="overflow-x-auto">
          <nav className="flex w-max min-w-full gap-6 -mb-px" aria-label="Token contract tabs">
            {visibleTokenTabs.map((t) => {
              const active = resolvedTab === t.key;
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
                  {t.key === 'holders' && tokenDetail?.holders != null && tokenDetail.holders > 0 && (
                    <span className="ml-1.5 text-xs text-white/35">({formatNumber(tokenDetail.holders)})</span>
                  )}
                </button>
              );
            })}
          </nav>
        </div>
      </div>

      {/* ── Tab content ─────────────────────────────────────────────── */}
      <div className="rounded-3xl border border-white/10 bg-white/5 overflow-hidden">
        {resolvedTab === 'transfers' && (
          <TokenContractTransfersTab addr={addr} tokenDetail={tokenDetail} />
        )}
        {resolvedTab === 'holders' && (
          <HoldersTab addr={addr} tokenDetail={tokenDetail} />
        )}
        {resolvedTab === 'contract' && (
          <ContractTab addr={addr} tokenDetail={tokenDetail} />
        )}
        {resolvedTab === 'interact' && !isNft && (
          <InteractTab addr={addr} tokenDetail={tokenDetail} />
        )}
      </div>
    </div>
  );
}

/* ── Wallet address layout ───────────────────────────────────────────── */

function WalletLayout({
  account,
  txs,
  txPageInfo,
  txsLoading,
  activeTab,
  setTab,
  usdPrice,
  onTxPageChange,
}: {
  account: ApiAddress;
  txs: ApiTx[] | null;
  txPageInfo: PageInfo | null;
  txsLoading: boolean;
  activeTab: TabKey;
  setTab: (key: TabKey) => void;
  usdPrice: number | null;
  onTxPageChange: (offset: number) => void;
}) {
  const resolvedTab = WALLET_TABS.some((t) => t.key === activeTab) ? activeTab : 'transactions';
  const currentAddrs = [account.address, account.evmAddress, account.cosmosAddress].filter((value): value is string => Boolean(value));

  const altAddress = account.evmAddress && account.evmAddress !== account.address
    ? account.evmAddress
    : account.cosmosAddress && account.cosmosAddress !== account.address
      ? account.cosmosAddress
      : null;
  const altAddressLabel = altAddress?.startsWith('0x') ? 'EVM' : 'Lithosphere';
  const balanceSource = account.balanceSource;
  const hasBalance = hasDisplayBalance(account.balance, balanceSource);
  const showUsdValue = balanceSource === 'rpc' && hasBalance && usdPrice != null;

  return (
    <div className="text-white space-y-6">
      {/* ── Header ──────────────────────────────────────────────────── */}
      <div>
        <div className="flex items-center gap-2 text-sm text-white/40 mb-4">
          <Link href="/" className="hover:text-white/70 transition">Home</Link>
          <span>/</span>
          <span className="text-white/70">Address</span>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center gap-3 min-w-0">
          <h1 className="flex-1 min-w-0 text-2xl font-semibold break-all break-words">
            <span className="font-mono">{account.address}</span>
          </h1>
          <div className="flex items-center gap-2 shrink-0">
            <CopyBtn text={account.address} />
            {account.isValidator ? (
              <span className="inline-flex items-center rounded-full border border-violet-400/30 bg-violet-400/10 px-2.5 py-0.5 text-xs font-medium text-violet-300">Validator</span>
            ) : (
              <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${account.txCount > 0 ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300' : 'border-white/20 bg-white/5 text-white/50'}`}>
                {account.txCount > 0 ? 'Active' : 'Inactive'}
              </span>
            )}
          </div>
        </div>

        {altAddress && (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
            <span className="inline-flex items-center rounded-full border border-white/10 bg-white/5 px-2.5 py-0.5 text-[11px] font-medium uppercase tracking-wide text-white/45">
              {altAddressLabel}
            </span>
            <Link href={`/address/${altAddress}`} className="font-mono text-white/55 hover:text-emerald-300 transition">{altAddress}</Link>
            <CopyBtn text={altAddress} />
          </div>
        )}
      </div>

      {/* ── Overview cards ──────────────────────────────────────────── */}
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-3xl border border-white/10 bg-white/5 p-5">
          <div className="text-sm text-white/45 mb-1">Balance</div>
          <div className="text-xl font-semibold">
            {formatAddressBalance(account.balance, balanceSource)}
          </div>
          {showUsdValue && (
            <div className="text-sm text-white/40 mt-1 font-mono">
              {(() => {
                try {
                  const usd = (Number(BigInt(account.balance)) / 1e18) * usdPrice;
                  return usd.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
                } catch { return null; }
              })()}
            </div>
          )}
          <BalanceSourceStatus balanceSource={balanceSource} />
        </div>
        <div className="rounded-3xl border border-white/10 bg-white/5 p-5">
          <div className="text-sm text-white/45 mb-1">{account.isValidator ? 'Blocks Proposed' : 'Transactions'}</div>
          <div className="text-xl font-semibold">
            {formatNumber(account.isValidator ? (account.blocksProposed ?? 0) : account.txCount)}
          </div>
        </div>
        <div className="rounded-3xl border border-white/10 bg-white/5 p-5">
          <div className="text-sm text-white/45 mb-1">Last Active</div>
          <div className="text-xl font-semibold">{account.lastSeen ? timeAgo(account.lastSeen) : '--'}</div>
        </div>
      </div>

      {/* ── Holdings ────────────────────────────────────────────────── */}
      <HoldingsSection balance={account.balance} balanceSource={balanceSource} usdPrice={usdPrice} />

      {/* ── Tab bar ─────────────────────────────────────────────────── */}
      <div className="border-b border-white/10 overflow-x-auto">
        <nav className="flex gap-6 -mb-px whitespace-nowrap" aria-label="Address tabs">
          {WALLET_TABS.map((t) => {
            const isActive = resolvedTab === t.key;
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`pb-3 text-sm font-medium transition border-b-2 shrink-0 ${isActive ? 'border-emerald-400 text-white' : 'border-transparent text-white/50 hover:text-white/70'}`}
              >
                {t.label}
                {t.key === 'transactions' && account.txCount > 0 && (
                  <span className="ml-1.5 text-xs text-white/35">({formatNumber(account.txCount)})</span>
                )}
              </button>
            );
          })}
        </nav>
      </div>

      {/* ── Tab content ─────────────────────────────────────────────── */}
      <div className="rounded-3xl border border-white/10 bg-white/5 overflow-hidden">
        {resolvedTab === 'transactions' && (
          <TxTable
            txs={txs}
            loading={txsLoading}
            currentAddrs={currentAddrs}
            emptyLabel="No transactions found"
            pageInfo={txPageInfo}
            onPageChange={onTxPageChange}
          />
        )}
        {resolvedTab === 'transfers' && (
          <TokenTransfersTab
            addr={account.evmAddress ?? account.address}
            currentAddrs={currentAddrs}
          />
        )}
        {resolvedTab === 'tokens' && <TokensTab addr={account.evmAddress ?? account.address} />}
      </div>
    </div>
  );
}

/* ── Main page ────────────────────────────────────────────────────────── */

export default function AddressPage() {
  const router = useRouter();
  const { address, tab } = router.query;
  const addr = typeof address === 'string' ? address : '';
  const activeTab: TabKey =
    typeof tab === 'string' ? (tab as TabKey) : 'transactions';
  const [txOffset, setTxOffset] = useState(0);

  const { data: account, loading: accountLoading, error: accountError } =
    useApi<ApiAddress>(addr ? `/address/${addr}` : null);

  useEffect(() => {
    setTxOffset(0);
  }, [addr]);

  const { data: txsData, loading: txsLoading } =
    useApi<ApiAddressTxList>(addr ? `/address/${addr}/txs?limit=${ADDRESS_TX_PAGE_SIZE}&offset=${txOffset}` : null);
  const txs = txsData?.items ?? null;
  const txPageInfo: PageInfo | null = txsData
    ? {
        total: txsData.total,
        limit: txsData.limit,
        offset: txsData.offset,
        hasMore: txsData.hasMore,
      }
    : null;

  // Fetch token detail if this is a token contract
  const isContract = account ? detectIsContract(account) : false;
  const isToken = account?.isToken ?? false;
  const { data: tokenDetail } =
    useApi<ApiTokenDetail>((isContract || isToken) && addr ? `/tokens/${addr}` : null);

  // Fetch LITHO price for USD display
  const { data: priceData } = useApi<ApiPrice>('/price');
  const usdPrice = priceData?.price ?? null;

  const setTab = useCallback(
    (key: TabKey) => {
      router.push(
        { pathname: router.pathname, query: { address: addr, tab: key } },
        undefined,
        { shallow: true },
      );
    },
    [router, addr],
  );

  if (accountLoading) return <PageSkeleton />;

  // If the API doesn't know this address but it's syntactically valid (e.g.,
  // the zero address used for mints/burns, or any wallet that hasn't transacted
  // yet), render a placeholder wallet page instead of a hard 404.
  const fallbackAccount: ApiAddress | null =
    !account && isPlausibleAddress(addr) ? buildStubAddress(addr) : null;

  if ((accountError || !account) && !fallbackAccount) {
    return (
      <div className="text-white">
        <div className="rounded-3xl border border-red-400/20 bg-red-400/5 p-8 text-center">
          <div className="text-lg font-medium text-red-300 mb-2">Address Not Found</div>
          <div className="text-sm text-white/50 mb-4">
            {accountError ?? 'This address has no indexed activity yet.'}
          </div>
          <Link href="/" className="text-sm text-emerald-300 hover:text-emerald-200">&larr; Back to Explorer</Link>
        </div>
      </div>
    );
  }

  const resolvedAccount: ApiAddress = (account ?? fallbackAccount)!;
  const isStub = !account;
  const isZeroAddress = addr.toLowerCase() === ZERO_ADDRESS;

  return (
    <>
      <Head>
        <title>
          {isZeroAddress ? 'Zero Address' : isContract ? 'Contract' : 'Address'} {truncateHash(resolvedAccount.address, 12, 6)} | {EXPLORER_TITLE}
        </title>
        <meta name="description" content={`View Lithosphere ${isContract ? 'contract details' : 'address balances'}, transactions, and token holdings for ${resolvedAccount.address}.`} />
      </Head>

      {isStub && (
        <div className="mb-4 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-white/60">
          {isZeroAddress
            ? 'This is the zero address — used as the source/destination for token mints, burns, and other system-level transfers. It is not a real wallet.'
            : 'No indexed activity for this address yet. Showing a placeholder page; balances and history will appear once transactions are indexed.'}
        </div>
      )}

      {isContract ? (
        <TokenContractLayout
          account={resolvedAccount}
          tokenDetail={tokenDetail}
          addr={addr}
          activeTab={activeTab}
          setTab={setTab}
        />
      ) : (
        <WalletLayout
          account={resolvedAccount}
          txs={txs}
          txPageInfo={txPageInfo}
          txsLoading={txsLoading}
          activeTab={activeTab}
          setTab={setTab}
          usdPrice={usdPrice}
          onTxPageChange={setTxOffset}
        />
      )}
    </>
  );
}
