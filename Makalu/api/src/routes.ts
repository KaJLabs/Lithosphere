/**
 * REST API routes consumed by the Explorer frontend.
 *
 * The explorer calls /api/* paths (e.g. /api/blocks, /api/stats/summary).
 * Routes query the same PostgreSQL database that the indexer writes to.
 */
import { Router, type Request, type Response } from 'express';
import { bech32 } from 'bech32';
import { randomBytes, createHmac, timingSafeEqual } from 'node:crypto';
import { verifyMessage, isAddress, getAddress } from 'ethers';
import { query, slowQuery } from './db.js';
import { logger } from './lib/logger.js';
import { audit } from './lib/audit.js';
import { loadCachedShared } from './lib/shared-cache.js';
import { recoverTxMemo } from './tx-memo.js';
import { fetchLithoMarketPrice, fetchNativeSupply } from './market-data.js';
import {
  isEvmTxHash,
  normalizeEvmTxHash,
  pickValidTxHash,
  sanitizeUpstreamMessage,
} from './tx-utils.js';
import {
  buildQuanttInsightsUrl,
  loadQuanttConfig,
  quanttAuthHeaders,
  QUANTT_DEVELOPER_URL,
  QUANTT_RESEARCH_URL,
} from './quantt.js';

/**
 * Strip control characters from a value before interpolating into a log line.
 *
 * User-controlled strings can contain CR/LF that splits a single log entry
 * across multiple lines (forging fake log rows in shared aggregators) or
 * ANSI escape codes that corrupt the terminal output during local tail.
 * Replace anything outside printable ASCII + common whitespace with `?`
 * before log interpolation. Truncates to 200 chars as belt-and-braces.
 *
 * Used at each `logger.warn({ field: sanitizeForLog(userValue) }, ...)` call site
 * below to satisfy CodeQL `js/log-injection` while keeping the structured pino
 * fields safe (those go through JSON serialisation already, but defence in depth).
 */
function sanitizeForLog(value: unknown): string {
  const str = typeof value === 'string' ? value : String(value);
  // The explicit `\r\n` replace is the pattern CodeQL's js/log-injection
  // taint analysis recognises as a newline sanitizer. The follow-up
  // control-char strip is belt-and-braces (covers ESC for ANSI escapes,
  // BEL, etc.). Truncate to 200 chars as a final guard.
  return str
    .replace(/[\r\n]/g, ' ')
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1f\x7f]/g, '?')
    .slice(0, 200);
}

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const HIDDEN_TOKEN_SYMBOLS = new Set<string>();
const HIDDEN_TOKEN_ADDRESSES = new Set([
  '0x468022f17cafebd43c18f68d53c66a1a7f0e5249',
]);
const RPC_URL = (process.env.RPC_URL || process.env.LITHO_RPC_URL || 'https://rpc.litho.ai').replace(/\/$/, '');
const SYNCING_LAG_THRESHOLD = 1000;
const EVM_RPC_URL = (process.env.EVM_RPC_URL || '').replace(/\/$/, '');
// Keep a public EVM RPC as a last resort so direct tx lookups still work when
// the server's private RPC is missing older historical transaction data.
const PUBLIC_EVM_RPC_URL = (process.env.PUBLIC_EVM_RPC_URL || 'https://rpc.litho.ai').replace(/\/$/, '');
const EVM_RPC_ENDPOINTS = [...new Set([EVM_RPC_URL, RPC_URL, PUBLIC_EVM_RPC_URL].filter(Boolean))];
const COUNT_CACHE_TTL_MS = 10_000;
const STATS_SUMMARY_TTL_MS = 15_000;
// Data-integrity diagnostic: full GROUP BY over the whole transactions table
// (~5M rows, ~8s). It drifts slowly and only needs to be roughly fresh, so it
// gets a long TTL and is kept OFF the 15s stats hot path.
const INCONSISTENT_BLOCKS_TTL_MS = 300_000;
// Heavy aggregate counts on the stats summary (total txs, distinct wallet
// addresses over ~5M rows). Slow-drifting, so cache them well beyond the 15s
// stats TTL — otherwise each stats miss re-runs the full-table scans.
const STATS_COUNT_TTL_MS = 300_000;
// Distinct-wallet count is the heaviest stats aggregate (UNION + DISTINCT over the
// ~5M-row evm_transactions table, ~17s and growing). It's an all-time, slowly-
// drifting figure, so cache it for an hour and compute it on the slow pool so a
// recompute can't 500 /stats/summary.
const STATS_WALLET_TTL_MS = 3_600_000;
const EVM_ENRICH_TTL_MS = 600_000;
const MAX_RUNTIME_CACHE_ENTRIES = 2_000;

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const runtimeCache = new Map<string, CacheEntry<unknown>>();
const runtimeCachePending = new Map<string, Promise<unknown>>();

function readCache<T>(key: string): T | null {
  const cached = runtimeCache.get(key);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    runtimeCache.delete(key);
    return null;
  }
  return cached.value as T;
}

function trimRuntimeCache(): void {
  if (runtimeCache.size <= MAX_RUNTIME_CACHE_ENTRIES) return;
  const now = Date.now();
  for (const [key, entry] of runtimeCache) {
    if (entry.expiresAt <= now || runtimeCache.size > MAX_RUNTIME_CACHE_ENTRIES) {
      runtimeCache.delete(key);
    }
    if (runtimeCache.size <= MAX_RUNTIME_CACHE_ENTRIES) break;
  }
}

function writeCache<T>(key: string, value: T, ttlMs: number): T {
  runtimeCache.set(key, { value, expiresAt: Date.now() + ttlMs });
  trimRuntimeCache();
  return value;
}

async function loadCached<T>(key: string, ttlMs: number, loader: () => Promise<T>): Promise<T> {
  const cached = readCache<T>(key);
  if (cached !== null) return cached;

  const pending = runtimeCachePending.get(key) as Promise<T> | undefined;
  if (pending) return pending;

  const promise = loader()
    .then((value) => writeCache(key, value, ttlMs))
    .finally(() => {
      runtimeCachePending.delete(key);
    });

  runtimeCachePending.set(key, promise as Promise<unknown>);
  return promise;
}

function isHiddenToken(token: { symbol?: string | null; address?: string | null }): boolean {
  const symbol = token.symbol?.trim();
  const address = token.address?.toLowerCase();
  return (symbol ? HIDDEN_TOKEN_SYMBOLS.has(symbol) : false)
    || (address ? HIDDEN_TOKEN_ADDRESSES.has(address) : false);
}

type AssetType = 'native' | 'LEP100' | 'LEP100-6';

function isNftContractType(contractType: string | null | undefined): boolean {
  return contractType?.toLowerCase() === 'nft';
}

function isFungibleContractType(contractType: string | null | undefined, symbol?: string | null): boolean {
  return contractType?.toLowerCase() === 'token' || (!contractType && !!symbol);
}

function getAssetType(contractType: string | null | undefined, symbol?: string | null): AssetType {
  if (isNftContractType(contractType)) return 'LEP100-6';
  if (isFungibleContractType(contractType, symbol)) return 'LEP100';
  return 'LEP100';
}

function getDefaultTokenDecimals(contractType: string | null | undefined): number {
  return isNftContractType(contractType) ? 0 : 18;
}

function getAssetStandard(type: AssetType): string {
  switch (type) {
    case 'native':
      return 'Native';
    case 'LEP100-6':
      return 'LEP100-6';
    case 'LEP100':
    default:
      return 'LEP-100';
  }
}

async function getTokenTransferIndexStatus(): Promise<{
  evmTxCount: number;
  transferCount: number;
  ready: boolean;
}> {
  const [transferRows, evmRows] = await Promise.all([
    query<CountRow>('SELECT COUNT(*) AS count FROM token_transfers').catch(() => [{ count: '0' }]),
    query<CountRow>('SELECT COUNT(*) AS count FROM evm_transactions').catch(() => [{ count: '0' }]),
  ]);

  const transferCount = parseInt(transferRows[0]?.count ?? '0');
  const evmTxCount = parseInt(evmRows[0]?.count ?? '0');

  return {
    evmTxCount,
    transferCount,
    // If EVM txs exist but there are still no transfer logs, the FT transfer
    // index is incomplete and holder/transfer counts should stay unknown.
    ready: transferCount > 0 || evmTxCount === 0,
  };
}

async function getTokenStatsByContract(): Promise<Map<string, { holders: number; transfers: number }>> {
  const ZERO_ADDR = '0x0000000000000000000000000000000000000000';
  // Holders = addresses with a positive *net* balance (received − sent),
  // not every address that ever appeared in a transfer. This matches the
  // per-token /tokens/:address/holders logic so the list and detail pages
  // agree. NUMERIC keeps the big-int aggregation exact.
  const rows = await query<{
    contract_address: string;
    holders: number;
    transfers: number;
  }>(
    `WITH flows AS (
       SELECT LOWER(contract_address) AS contract_address, to_address   AS addr,  value::numeric AS amt
       FROM token_transfers
       UNION ALL
       SELECT LOWER(contract_address) AS contract_address, from_address AS addr, -value::numeric AS amt
       FROM token_transfers
     ),
     balances AS (
       SELECT contract_address, addr, SUM(amt) AS bal
       FROM flows
       WHERE addr IS NOT NULL AND addr != $1
       GROUP BY contract_address, addr
     ),
     holder_counts AS (
       SELECT contract_address, COUNT(*)::int AS holders
       FROM balances
       WHERE bal > 0
       GROUP BY contract_address
     ),
     transfer_counts AS (
       SELECT LOWER(contract_address) AS contract_address, COUNT(*)::int AS transfers
       FROM token_transfers
       GROUP BY LOWER(contract_address)
     )
     SELECT COALESCE(t.contract_address, h.contract_address) AS contract_address,
            COALESCE(h.holders, 0)::int AS holders,
            COALESCE(t.transfers, 0)::int AS transfers
     FROM transfer_counts t
     FULL OUTER JOIN holder_counts h ON h.contract_address = t.contract_address`,
    [ZERO_ADDR]
  ).catch(() => []);

  return new Map(
    rows.map((row) => [
      row.contract_address.toLowerCase(),
      { holders: Number(row.holders ?? 0), transfers: Number(row.transfers ?? 0) },
    ])
  );
}

/**
 * Per-collection NFT (ERC-721) stats keyed by lowercased contract address.
 *  - items:     distinct token_ids ever minted in the collection
 *  - holders:   distinct *current* owners (latest to_address per token_id),
 *               excluding the zero address (burned tokens have no holder)
 *  - transfers: total ERC-721 Transfer events for the collection
 * Current ownership is derived from the most recent transfer per token_id,
 * unlike fungible holder counts which approximate from transfer participants.
 */
async function getNftStatsByContract(): Promise<Map<string, { items: number; holders: number; transfers: number }>> {
  const ZERO_ADDR = '0x0000000000000000000000000000000000000000';
  const rows = await query<{
    contract_address: string;
    items: number;
    holders: number;
    transfers: number;
  }>(
    `WITH nft AS (
       SELECT LOWER(contract_address) AS contract_address, token_id, to_address, block_height, log_index
       FROM token_transfers
       WHERE token_id IS NOT NULL
     ),
     latest AS (
       SELECT DISTINCT ON (contract_address, token_id)
              contract_address, token_id, to_address
       FROM nft
       ORDER BY contract_address, token_id, block_height DESC, log_index DESC
     ),
     transfer_counts AS (
       SELECT contract_address, COUNT(*)::int AS transfers
       FROM nft
       GROUP BY contract_address
     )
     SELECT l.contract_address,
            COUNT(DISTINCT l.token_id)::int AS items,
            COUNT(DISTINCT l.to_address) FILTER (WHERE l.to_address <> $1)::int AS holders,
            COALESCE(MAX(t.transfers), 0)::int AS transfers
     FROM latest l
     LEFT JOIN transfer_counts t ON t.contract_address = l.contract_address
     GROUP BY l.contract_address`,
    [ZERO_ADDR]
  ).catch(() => []);

  return new Map(
    rows.map((row) => [
      row.contract_address.toLowerCase(),
      {
        items: Number(row.items ?? 0),
        holders: Number(row.holders ?? 0),
        transfers: Number(row.transfers ?? 0),
      },
    ])
  );
}

async function getCachedCount(
  key: string,
  sql: string,
  params: unknown[] = [],
  ttlMs = COUNT_CACHE_TTL_MS,
): Promise<number> {
  return loadCached<number>(`count:${key}:${JSON.stringify(params)}`, ttlMs, async () => {
    const rows = await query<CountRow>(sql, params);
    return parseInt(rows[0]?.count ?? '0', 10);
  });
}

/**
 * Convert EVM wei to ulitho.
 * Lithosphere uses 18 decimals (Ethermint): 1 LITHO = 1e18 ulitho.
 * 1 wei = 1 ulitho, so no conversion needed.
 */
export function weiToUlitho(wei: string | null | undefined): string {
  if (!wei || wei === '0') return '0';
  try {
    return String(BigInt(wei));
  } catch {
    return '0';
  }
}

export function clamp(val: unknown, def = DEFAULT_LIMIT): number {
  const n = Number(val);
  if (!n || n < 1) return def;
  return Math.min(n, MAX_LIMIT);
}

export function clampOffset(val: unknown): number {
  const n = Number(val);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

// Accept either ?offset=N or ?page=N (1-indexed) from the client.
// Older deployed explorers send page=N; current ones send offset=M.
function resolveOffset(query: Request['query'], limit: number): number {
  if (query.offset != null) return clampOffset(query.offset);
  const page = Number(query.page);
  if (Number.isFinite(page) && page > 1) return Math.floor(page - 1) * limit;
  return 0;
}

export function normalizeFaucetAmountInput(value: unknown): { value?: string; invalid: boolean } {
  if (value == null) {
    return { invalid: false };
  }

  if (typeof value === 'number') {
    if (Number.isFinite(value) && value > 0) {
      return { value: value.toString(), invalid: false };
    }
    return { invalid: true };
  }

  if (typeof value !== 'string') {
    return { invalid: true };
  }

  const trimmed = value.trim();
  if (!trimmed || !/^\d+(\.\d+)?$/.test(trimmed)) {
    return { invalid: true };
  }

  return { value: trimmed, invalid: false };
}

/** Convert an EVM 0x address to its Cosmos bech32 equivalent (litho1...). */
export function evmToCosmos(evmAddr: string | null | undefined): string | undefined {
  if (!evmAddr) return undefined;
  try {
    const hex = evmAddr.replace(/^0x/i, '');
    if (hex.length !== 40) return undefined;
    const bytes = Buffer.from(hex, 'hex');
    const words = bech32.toWords(bytes);
    return bech32.encode('litho', words);
  } catch {
    return undefined;
  }
}

/** Convert a Cosmos bech32 address (litho1...) to its EVM 0x equivalent. */
export function cosmosToEvm(cosmosAddr: string | null | undefined): string | undefined {
  if (!cosmosAddr) return undefined;
  try {
    const decoded = bech32.decode(cosmosAddr.toLowerCase());
    if (decoded.prefix !== 'litho') return undefined;
    const bytes = Buffer.from(bech32.fromWords(decoded.words));
    if (bytes.length !== 20) return undefined;
    return `0x${bytes.toString('hex')}`;
  } catch {
    return undefined;
  }
}

/**
 * Normalize a contract-address route param to the form stored in the DB.
 *
 * `contracts.address` holds EVM 0x values, but the explorer links to contracts
 * by their Lithosphere bech32 identity, so /tokens/litho1… must resolve to the
 * same record as /tokens/0x…. Without this, those routes returned "Token
 * contract not found" and empty transfers/holders for a perfectly valid token.
 *
 * Anything that isn't a decodable litho1 address is passed through untouched,
 * which keeps the `native` sentinel and existing 0x callers working.
 */
export function normalizeContractAddress(address: string): string {
  if (!address || !address.toLowerCase().startsWith('litho1')) return address;
  return cosmosToEvm(address) ?? address;
}

interface AddressForms {
  query: string;
  queryLower: string;
  cosmosAddress?: string;
  evmAddress?: string;
  searchAddrs: string[];
  contractSearchAddrs: string[];
}

export type BalanceSource = 'rpc' | 'indexed' | 'unavailable';

export interface NativeBalanceResolution {
  balance: string;
  balanceSource: BalanceSource;
  rpcAttempted: boolean;
}

function resolveAddressForms(
  address: string,
  account?: Pick<AccountRow, 'address' | 'evm_address'> | null
): AddressForms {
  const query = address.trim();
  const queryLower = query.toLowerCase();
  const derivedEvm = queryLower.startsWith('0x') ? queryLower : cosmosToEvm(queryLower);
  const derivedCosmos = queryLower.startsWith('litho1') ? queryLower : evmToCosmos(queryLower)?.toLowerCase();
  const accountAddress = account?.address?.toLowerCase();
  const accountEvmAddress = account?.evm_address?.toLowerCase();

  const searchSet = new Set<string>();
  const contractSet = new Set<string>();
  const addSearch = (value?: string | null) => {
    if (value) searchSet.add(value.toLowerCase());
  };
  const addContract = (value?: string | null) => {
    if (value) contractSet.add(value.toLowerCase());
  };

  addSearch(queryLower);
  addSearch(derivedCosmos);
  addSearch(derivedEvm);
  addSearch(accountAddress);
  addSearch(accountEvmAddress);

  addContract(queryLower);
  addContract(derivedEvm);
  addContract(accountAddress);
  addContract(accountEvmAddress);

  const cosmosAddress = (accountAddress?.startsWith('litho1') ? accountAddress : undefined)
    ?? (derivedCosmos?.startsWith('litho1') ? derivedCosmos : undefined);
  const evmAddress = (accountEvmAddress?.startsWith('0x') ? accountEvmAddress : undefined)
    ?? (derivedEvm?.startsWith('0x') ? derivedEvm : undefined);

  return {
    query,
    queryLower,
    cosmosAddress,
    evmAddress,
    searchAddrs: [...searchSet],
    contractSearchAddrs: [...contractSet],
  };
}

// ── Row types (mirror DB columns) ───────────────────────────────────────────

interface BlockRow {
  height: string;
  hash: string;
  proposer_address: string | null;
  num_txs: number;
  total_gas: string;
  block_time: Date;
}

interface TxRow {
  hash: string;
  block_height: string;
  tx_index: number | null;
  tx_type: string | null;
  sender: string | null;
  receiver: string | null;
  amount: string | null;
  denom: string | null;
  gas_used: string | null;
  gas_wanted: string | null;
  fee: string | null;
  fee_denom: string | null;
  success: boolean;
  memo: string | null;
  raw_log: string | null;
  timestamp: Date;
}

interface AccountRow {
  address: string;
  evm_address: string | null;
  balance: string;
  tx_count: string;
  last_seen_block: string | null;
  updated_at: Date;
}

interface ValidatorRow {
  operator_address: string;
  consensus_address?: string | null;
  identity?: string | null;
  website?: string | null;
  security_contact?: string | null;
  details?: string | null;
  moniker: string | null;
  tokens: string;
  delegator_shares?: string | null;
  commission_rate: string | null;
  commission_max_rate?: string | null;
  commission_max_change?: string | null;
  min_self_delegation?: string | null;
  status: number;
  jailed: boolean;
  uptime_percentage?: number | string | null;
  missed_blocks_counter?: number | string | null;
  updated_at?: Date | string | null;
  rank?: string | number | null;
  total_bonded_tokens?: string | null;
}

interface EvmTxRow {
  hash: string;
  cosmos_tx_hash: string;
  block_height: string;
  tx_index: number | null;
  from_address: string | null;
  to_address: string | null;
  value: string | null;
  gas_price: string | null;
  gas_limit: number | null;
  gas_used: number | null;
  nonce: number | null;
  input_data: string | null;
  contract_address: string | null;
  status: boolean;
  timestamp: Date;
}

interface CountRow { count: string }

interface SyncSummary {
  tipHeight: number;
  chainTipHeight: number;
  latestTransactionHeight: number;
  latestBlockTimestamp: string | null;
  latestTransactionTimestamp: string | null;
  syncLagBlocks: number;
  isSyncing: boolean;
  inconsistentBlocks: number;
}

interface StatsSummaryResponse extends SyncSummary {
  totalTransactions: number;
  /** Cumulative count of every address ever seen on-chain (all-time, not current holders). */
  walletAddresses: number;
  /** Distinct addresses that currently hold a non-zero native LITHO balance. */
  currentHolders: number;
  avgBlockTime: number;
  gasPriceWei: string | null;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Strip Ethereum branding from Cosmos SDK method names */
function cleanMethod(m: string | null | undefined): string | undefined {
  if (!m) return undefined;
  return m.replace(/MsgEthereumTx/g, 'MsgTx');
}

/** Classify EVM transaction type based on inputData and toAddr */
export function classifyTxType(inputData?: string | null, toAddr?: string | null, contractAddr?: string | null): 'transfer' | 'call' | 'create' {
  if (!toAddr && contractAddr) return 'create';
  if (inputData && inputData !== '0x' && inputData.length > 2) return 'call';
  return 'transfer';
}

/** Common 4-byte EVM function selectors → human-readable method names */
const METHOD_SIGS: Record<string, string> = {
  '0xa9059cbb': 'Transfer', '0x23b872dd': 'Transfer From', '0x095ea7b3': 'Approve',
  '0x70a08231': 'Balance Of', '0x18160ddd': 'Total Supply', '0x313ce567': 'Decimals',
  '0x06fdde03': 'Name', '0x95d89b41': 'Symbol', '0xdd62ed3e': 'Allowance',
  '0x3593564c': 'Execute', '0x5ae401dc': 'Multicall', '0x1249c58b': 'Mint',
  '0xa0712d68': 'Mint', '0x40c10f19': 'Mint', '0x42842e0e': 'Safe Transfer From',
  '0xf242432a': 'Safe Transfer From', '0xd0e30db0': 'Deposit', '0x2e1a7d4d': 'Withdraw',
  '0x3ccfd60b': 'Withdraw', '0xa22cb465': 'Set Approval For All', '0x4e71d92d': 'Claim',
  '0x2eb2c2d6': 'Safe Batch Transfer', '0x5c19a95c': 'Delegate',
  '0xb858183f': 'Handle Ops', '0x1fad948c': 'Handle Ops',
  '0x765e827f': 'Execute Batch', '0x51945447': 'Execute', '0xb61d27f6': 'Execute',
  '0xe9ae5c53': 'Exec', '0x61461954': 'Exec',
  '0x12aa3caf': 'Swap', '0x0502b1c5': 'Uniswap V3 Swap', '0xe449022e': 'Uniswap V3 Swap',
  '0x7ff36ab5': 'Swap Exact ETH For Tokens', '0x38ed1739': 'Swap Exact Tokens For Tokens',
  '0x18cbafe5': 'Swap Exact Tokens For ETH', '0x8803dbee': 'Swap Tokens For Exact Tokens',
  '0x4a25d94a': 'Swap Tokens For Exact ETH', '0xfb3bdb41': 'Swap ETH For Exact Tokens',
  '0xb6f9de95': 'Swap Exact ETH For Tokens', '0x791ac947': 'Swap Exact Tokens For ETH',
  '0xc9567bf9': 'Open Trading', '0x8da5cb5b': 'Owner',
  '0x715018a6': 'Renounce Ownership', '0xf2fde38b': 'Transfer Ownership',
  '0x60806040': 'Deploy', '0x60a06040': 'Deploy', '0x60c06040': 'Deploy',
};

/** Decode method name from input_data's first 4 bytes */
export function decodeMethodName(inputData?: string | null): string | undefined {
  if (!inputData || inputData === '0x' || inputData.length < 10) return undefined;
  const selector = inputData.slice(0, 10).toLowerCase();
  return METHOD_SIGS[selector] ?? selector;
}

/** Decode ERC-20 Transfer amount from input data (selector 0xa9059cbb)
 *  function transfer(address to, uint256 amount)
 *  Params: 2nd param (amount) is at offset 64-128 (bytes 32-64 in hex string)
 */
export function decodeTransferAmount(inputData?: string | null): string | null {
  if (!inputData || inputData.length < 138) return null; // Need 0x + 4 + 64 + 64 = 138 chars
  const selector = inputData.slice(0, 10).toLowerCase();
  // 0xa9059cbb is the selector for transfer(address, uint256)
  if (selector !== '0xa9059cbb') return null;
  try {
    // Amount is the 2nd parameter, starting at position 10 + 64 = 74
    const amountHex = inputData.slice(74, 138);
    return BigInt('0x' + amountHex).toString();
  } catch {
    return null;
  }
}

/** Compute fee in ulitho from gasUsed and gasPrice (wei string).
 *  Lithosphere: 1 wei = 1 ulitho, so fee = gasUsed * gasPrice  */
export function computeFeeUlitho(gasUsed: string | number | null | undefined, gasPriceWei: string | null | undefined): string | null {
  if (!gasUsed || !gasPriceWei || gasPriceWei === '0') return null;
  try {
    const fee = BigInt(gasUsed) * BigInt(gasPriceWei);
    return String(fee);
  } catch {
    return null;
  }
}

/** Parse hex string to decimal string using BigInt (safe for large values) */
export function hexToDec(hex: string | null | undefined): string {
  if (!hex || hex === '0x0' || hex === '0x') return '0';
  try { return String(BigInt(hex)); } catch { return '0'; }
}

export function parseIntSafe(value: string | number | null | undefined): number {
  const parsed = typeof value === 'number' ? value : parseInt(value ?? '0', 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function parseHexInteger(value: string | null | undefined): number | null {
  if (!value) return null;
  try {
    const parsed = Number(BigInt(value));
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function toIsoString(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export function hexTimestampToIso(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const millis = Number(BigInt(value) * 1000n);
    if (!Number.isFinite(millis)) return undefined;
    return new Date(millis).toISOString();
  } catch {
    return undefined;
  }
}

const INCONSISTENT_BLOCKS_CTE = `
  WITH tx_counts AS (
    SELECT block_height::bigint AS height, COUNT(*)::bigint AS tx_count
    FROM transactions
    GROUP BY block_height
  ),
  inconsistent_blocks AS (
    SELECT b.height::bigint AS height
    FROM blocks b
    LEFT JOIN tx_counts t ON t.height = b.height::bigint
    WHERE COALESCE(t.tx_count, 0) <> COALESCE(b.num_txs, 0)
    UNION
    SELECT t.height
    FROM tx_counts t
    LEFT JOIN blocks b ON b.height::bigint = t.height
    WHERE b.height IS NULL
  )
`;

async function fetchChainTipHeight(): Promise<number> {
  try {
    const resp = await fetch(`${RPC_URL}/status`, { signal: AbortSignal.timeout(5000) });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const payload = await resp.json() as {
      result?: { sync_info?: { latest_block_height?: string } };
    };
    return parseIntSafe(payload.result?.sync_info?.latest_block_height);
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, '[api] chain tip fetch failed');
    return 0;
  }
}

async function getSyncSummary(): Promise<SyncSummary> {
  const [maxBlock, maxTx, inconsistentCount, chainTipHeight] = await Promise.all([
    query<{ height: string; block_time: Date | string | null }>(
      'SELECT COALESCE(MAX(height), 0)::text AS height, MAX(block_time) AS block_time FROM blocks'
    ),
    query<{ height: string; timestamp: Date | string | null }>(
      'SELECT COALESCE(MAX(block_height), 0)::text AS height, MAX(timestamp) AS timestamp FROM transactions'
    ),
    loadCachedShared('inconsistent-blocks', INCONSISTENT_BLOCKS_TTL_MS, () =>
      query<CountRow>(`
        ${INCONSISTENT_BLOCKS_CTE}
        SELECT COUNT(*) AS count FROM inconsistent_blocks
      `).catch(() => [{ count: '0' }])
    ),
    fetchChainTipHeight(),
  ]);

  const tipHeight = parseIntSafe(maxBlock[0]?.height);
  const latestTransactionHeight = parseIntSafe(maxTx[0]?.height);
  const syncLagBlocks = chainTipHeight > 0 ? Math.max(0, chainTipHeight - tipHeight) : 0;

  return {
    tipHeight,
    chainTipHeight,
    latestTransactionHeight,
    latestBlockTimestamp: toIsoString(maxBlock[0]?.block_time),
    latestTransactionTimestamp: toIsoString(maxTx[0]?.timestamp),
    syncLagBlocks,
    isSyncing: chainTipHeight > 0 && syncLagBlocks > SYNCING_LAG_THRESHOLD,
    inconsistentBlocks: parseIntSafe(inconsistentCount[0]?.count),
  };
}

async function getStatsSummaryResponse(): Promise<StatsSummaryResponse> {
  // Redis-backed so every API replica shares one warm copy (the stack runs
  // multiple replicas, each with its own in-memory cache). The heavy inner
  // aggregates below are ALSO shared, so even the replica that recomputes the
  // summary on a 15s miss reuses warm counts/CTE instead of re-scanning ~5M rows.
  return loadCachedShared<StatsSummaryResponse>('stats:summary', STATS_SUMMARY_TTL_MS, async () => {
    const [syncSummary, totalTransactions, walletAddresses, currentHolders, avgBlockTime, gasPriceWei] = await Promise.all([
      getSyncSummary(),
      // Slow-drifting totals on a ~5M-row table — long TTL, shared across replicas.
      // slowQuery: COUNT(*) over the whole table can exceed the 15s pool timeout.
      loadCachedShared('count:transactions-total', STATS_COUNT_TTL_MS, async () => {
        const rows = await slowQuery<CountRow>('SELECT COUNT(*) AS count FROM transactions');
        return parseInt(rows[0]?.count ?? '0', 10);
      }),
      // Distinct wallets across cosmos accounts + EVM tx participants. The outer
      // UNION already dedupes, so the inner DISTINCTs are redundant. Runs ~17s on
      // the slow pool (would 500 the endpoint on the 15s main pool) and is cached
      // for an hour since it's an all-time figure.
      loadCachedShared('count:wallet-addresses', STATS_WALLET_TTL_MS, async () => {
        const rows = await slowQuery<CountRow>(
          `SELECT COUNT(*) AS count FROM (
             SELECT address FROM accounts
             UNION
             SELECT from_address FROM evm_transactions WHERE from_address IS NOT NULL
             UNION
             SELECT to_address FROM evm_transactions WHERE to_address IS NOT NULL
           ) all_addrs`
        );
        return parseInt(rows[0]?.count ?? '0', 10);
      }),
      // Current holders = addresses with a non-zero native balance. The indexer's
      // balance sweep keeps accounts.balance warm via eth_getBalance, so this is a
      // real owner count rather than the historical-participant figure above.
      loadCachedShared('count:current-holders', STATS_COUNT_TTL_MS, async () => {
        const rows = await query<CountRow>(
          `SELECT COUNT(*) AS count FROM accounts WHERE balance IS NOT NULL AND balance <> '0'`
        );
        return parseInt(rows[0]?.count ?? '0', 10);
      }),
      query<{ avg_seconds: string }>(
        `SELECT COALESCE(EXTRACT(EPOCH FROM AVG(diff)), 0) AS avg_seconds FROM (
           SELECT block_time - LAG(block_time) OVER (ORDER BY height) AS diff
           FROM blocks ORDER BY height DESC LIMIT 100
         ) sub WHERE diff IS NOT NULL`
      ).catch(() => [{ avg_seconds: '0' }]),
      getCurrentGasPriceWei().catch(() => null),
    ]);

    return {
      ...syncSummary,
      totalTransactions,
      walletAddresses,
      currentHolders,
      avgBlockTime: Math.round(parseFloat(avgBlockTime[0]?.avg_seconds ?? '0') * 10) / 10,
      gasPriceWei,
    };
  });
}

/**
 * Fire-and-forget warm of the stats:summary cache (and its heavy sub-counts) so the
 * first request — and the deploy health-gate poll — after a restart hits a warm
 * cache instead of paying the multi-second aggregate recompute. Best-effort: any
 * error is swallowed so it never affects startup.
 */
export async function prewarmStatsSummary(): Promise<void> {
  try {
    await getStatsSummaryResponse();
    logger.info('[stats] summary cache prewarmed');
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, '[stats] prewarm failed');
  }
}

async function evmRpcCall(method: string, params: unknown[]): Promise<unknown> {
  if (EVM_RPC_ENDPOINTS.length === 0) return null;

  for (const endpoint of EVM_RPC_ENDPOINTS) {
    try {
      const resp = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'User-Agent': 'Makalu-API/1.0' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        signal: AbortSignal.timeout(10000),
      });
      if (!resp.ok) {
        logger.error({ method, status: resp.status, endpoint }, '[evmRpcCall] HTTP error');
        continue;
      }
      const data = await resp.json() as { result?: unknown; error?: unknown };
      if (data.error) {
        logger.error({ method, endpoint, rpcError: data.error }, '[evmRpcCall] RPC error');
        continue;
      }
      if (data.result != null) return data.result;
    } catch (err) {
      logger.error({ method, endpoint, err: err instanceof Error ? err.message : String(err) }, '[evmRpcCall] fetch exception');
    }
  }

  return null;
}

/** Fetch live EVM balance if address is an EVM address and RPC is available */
async function fetchLiveBalance(addr: string): Promise<string | null> {
  if (!/^0x/i.test(addr) || EVM_RPC_ENDPOINTS.length === 0) return null;
  try {
    const result = await evmRpcCall('eth_getBalance', [addr, 'latest']);
    if (typeof result === 'string') return hexToDec(result);
  } catch {}
  return null;
}

/** Decode the ABI-encoded string returned by an ERC-20 symbol()/name() eth_call. */
export function decodeAbiString(hexResult: unknown): string | null {
  if (typeof hexResult !== 'string' || hexResult.length <= 2) return null;
  const h = hexResult.slice(2);
  try {
    // Standard ABI dynamic string: [offset][length][bytes...]. Offset is 0x20.
    const len = parseInt(h.slice(64, 128), 16);
    if (!Number.isFinite(len) || len <= 0 || len > 256) return null;
    const s = Buffer.from(h.slice(128, 128 + len * 2), 'hex').toString('utf8').replace(/\0+$/, '').trim();
    return s.length > 0 && s.length <= 64 ? s : null;
  } catch {
    return null;
  }
}

/**
 * Read an ERC-20/LEP-100 token's symbol and name directly from the chain.
 *
 * Used as a last-resort enrichment when a token contract isn't in the indexer's
 * `contracts` table yet — otherwise a transfer of a valid-but-unindexed token
 * renders as a bare hex pill with no name. Cached because many tx views can hit
 * the same contract. Selectors: symbol() 0x95d89b41, name() 0x06fdde03.
 */
async function fetchTokenMetaOnchain(addr: string): Promise<{ symbol?: string; name?: string } | null> {
  if (!/^0x[0-9a-fA-F]{40}$/.test(addr) || EVM_RPC_ENDPOINTS.length === 0) return null;
  return loadCached(`token-meta:${addr.toLowerCase()}`, EVM_ENRICH_TTL_MS, async () => {
    try {
      const [symRes, nameRes] = await Promise.all([
        evmRpcCall('eth_call', [{ to: addr, data: '0x95d89b41' }, 'latest']),
        evmRpcCall('eth_call', [{ to: addr, data: '0x06fdde03' }, 'latest']),
      ]);
      const symbol = decodeAbiString(symRes) ?? undefined;
      const name = decodeAbiString(nameRes) ?? undefined;
      return symbol || name ? { symbol, name } : null;
    } catch {
      return null;
    }
  });
}

// Live gas-price cache: eth_gasPrice every poll would needlessly hammer the RPC
// when the homepage is open in many tabs. Cache the most recent value for a
// short window — the homepage poll is faster than the cache TTL, so users
// always see fresh-enough data without amplifying load.
const GAS_PRICE_CACHE_MS = 8_000;
let gasPriceCache: { value: string | null; fetchedAt: number } | null = null;

/** Fetch the current chain gas price in wei via eth_gasPrice. Cached briefly. */
async function getCurrentGasPriceWei(): Promise<string | null> {
  if (EVM_RPC_ENDPOINTS.length === 0) return null;
  const now = Date.now();
  if (gasPriceCache && now - gasPriceCache.fetchedAt < GAS_PRICE_CACHE_MS) {
    return gasPriceCache.value;
  }
  try {
    const result = await evmRpcCall('eth_gasPrice', []);
    const value = typeof result === 'string' ? hexToDec(result) : null;
    gasPriceCache = { value, fetchedAt: now };
    return value;
  } catch {
    gasPriceCache = { value: null, fetchedAt: now };
    return null;
  }
}

export async function resolveNativeBalance(
  evmAddress: string | null | undefined,
  indexedBalance: string | null | undefined,
  fetchBalance: (addr: string) => Promise<string | null> = fetchLiveBalance,
): Promise<NativeBalanceResolution> {
  const normalizedEvmAddress = typeof evmAddress === 'string' && /^0x/i.test(evmAddress)
    ? evmAddress
    : null;

  if (normalizedEvmAddress) {
    try {
      const liveBalance = await fetchBalance(normalizedEvmAddress);
      if (liveBalance != null) {
        return {
          balance: liveBalance,
          balanceSource: 'rpc',
          rpcAttempted: true,
        };
      }
    } catch {}

    if (indexedBalance != null) {
      return {
        balance: indexedBalance,
        balanceSource: 'indexed',
        rpcAttempted: true,
      };
    }

    return {
      balance: '0',
      balanceSource: 'unavailable',
      rpcAttempted: true,
    };
  }

  if (indexedBalance != null) {
    return {
      balance: indexedBalance,
      balanceSource: 'indexed',
      rpcAttempted: false,
    };
  }

  return {
    balance: '0',
    balanceSource: 'unavailable',
    rpcAttempted: false,
  };
}

function warnAddressBalanceFallback(
  queryAddress: string,
  resolution: NativeBalanceResolution,
  evmAddress?: string | null,
): void {
  if (!resolution.rpcAttempted || resolution.balanceSource === 'rpc') return;

  logger.warn(
    {
      queryAddress: sanitizeForLog(queryAddress),
      balanceSource: resolution.balanceSource,
      ...(evmAddress ? { evmAddress: sanitizeForLog(evmAddress) } : {}),
    },
    '[api] address native balance fallback',
  );
}

type EvmExtra = { value?: string | null; gas_price?: string | null; from_address?: string | null; to_address?: string | null; input_data?: string | null; contract_address?: string | null; nonce?: number | null };

export function hasNumericString(value: string | null | undefined): boolean {
  return typeof value === 'string' && /^\d+$/.test(value);
}

export function hasPositiveNumericString(value: string | null | undefined): boolean {
  return hasNumericString(value) && value !== '0';
}

export function preferString(primary?: string | null, fallback?: string | null): string | null | undefined {
  return primary != null && primary !== '' ? primary : fallback;
}

function mergeEvmExtra(base: EvmExtra, fallback: EvmExtra): EvmExtra {
  return {
    value: preferString(base.value, fallback.value),
    gas_price: preferString(base.gas_price, fallback.gas_price),
    from_address: preferString(base.from_address, fallback.from_address),
    to_address: preferString(base.to_address, fallback.to_address),
    input_data: preferString(base.input_data, fallback.input_data),
    contract_address: preferString(base.contract_address, fallback.contract_address),
    nonce: base.nonce ?? fallback.nonce,
  };
}

function needsRpcEnrichment(evmExtra: EvmExtra): boolean {
  return !hasNumericString(evmExtra.value)
    || !hasPositiveNumericString(evmExtra.gas_price)
    || !evmExtra.from_address
    || (!evmExtra.to_address && !evmExtra.contract_address)
    || !evmExtra.input_data
    || evmExtra.nonce == null;
}

interface RpcEvmTransaction {
  hash?: string;
  blockHash?: string | null;
  blockNumber?: string | null;
  from?: string;
  to?: string | null;
  gas?: string;
  gasPrice?: string;
  input?: string;
  nonce?: string;
  transactionIndex?: string;
  value?: string;
}

interface RpcEvmReceipt {
  blockHash?: string | null;
  blockNumber?: string | null;
  contractAddress?: string | null;
  effectiveGasPrice?: string;
  from?: string;
  gasUsed?: string;
  status?: string;
  to?: string | null;
  transactionHash?: string;
  transactionIndex?: string;
}

interface RpcEvmBlock {
  hash?: string;
  number?: string;
  timestamp?: string;
}

/** For EVM txs with missing/broken DB values, fetch live from RPC */
async function enrichEvmFromRpc(evmHash: string, evmExtra: EvmExtra): Promise<EvmExtra> {
  if (!needsRpcEnrichment(evmExtra)) return evmExtra;

  if (!isEvmTxHash(evmHash)) {
    logger.warn({ evmHash: String(evmHash).slice(0, 80) }, '[api] Skipping EVM enrichment for malformed hash');
    return evmExtra;
  }

  const normalizedHash = evmHash.toLowerCase();
  const rpcExtra = await loadCached<EvmExtra>(`evm-extra:${normalizedHash}`, EVM_ENRICH_TTL_MS, async () => {
    const rpcTx = await evmRpcCall('eth_getTransactionByHash', [evmHash]) as {
      value?: string;
      gasPrice?: string;
      from?: string;
      to?: string;
      input?: string;
      nonce?: string;
    } | null;

    if (!rpcTx) return {};

    const extra: EvmExtra = {};
    if (rpcTx.value) extra.value = hexToDec(rpcTx.value);
    if (rpcTx.gasPrice) extra.gas_price = hexToDec(rpcTx.gasPrice);
    if (rpcTx.from) extra.from_address = rpcTx.from.toLowerCase();
    if (rpcTx.to) extra.to_address = rpcTx.to.toLowerCase();
    if (rpcTx.input) extra.input_data = rpcTx.input;
    if (rpcTx.nonce) extra.nonce = Number(BigInt(rpcTx.nonce));
    return extra;
  });

  return mergeEvmExtra(evmExtra, rpcExtra);
}

async function enrichEvmRows<T extends { evm_hash?: string | null; evm_input_data?: string | null; evm_contract_address?: string | null; evm_from_address?: string | null; evm_to_address?: string | null; evm_value?: string | null; evm_gas_price?: string | null; evm_nonce?: number | null }>(rows: T[]): Promise<T[]> {
  return Promise.all(rows.map(async (r) => {
    if (r.evm_hash) {
      const extra = await enrichEvmFromRpc(r.evm_hash, {
        input_data: r.evm_input_data, contract_address: r.evm_contract_address, from_address: r.evm_from_address,
        to_address: r.evm_to_address, value: r.evm_value, gas_price: r.evm_gas_price, nonce: r.evm_nonce
      });
      r.evm_input_data = extra.input_data ?? null;
      r.evm_contract_address = extra.contract_address ?? null;
      r.evm_from_address = extra.from_address ?? null;
      r.evm_to_address = extra.to_address ?? null;
      r.evm_value = extra.value ?? null;
      r.evm_gas_price = extra.gas_price ?? null;
      r.evm_nonce = extra.nonce ?? null;
    }
    return r;
  }));
}

async function buildRpcFallbackTx(evmHash: string) {
  const normalizedHash = normalizeEvmTxHash(evmHash);
  if (!normalizedHash) return null;

  const rpcTx = await evmRpcCall('eth_getTransactionByHash', [normalizedHash]) as RpcEvmTransaction | null;
  if (!rpcTx) return null;

  const rpcReceipt = await evmRpcCall('eth_getTransactionReceipt', [normalizedHash]) as RpcEvmReceipt | null;
  const blockNumberHex = rpcTx.blockNumber ?? rpcReceipt?.blockNumber ?? null;
  const rpcBlock = blockNumberHex
    ? await evmRpcCall('eth_getBlockByNumber', [blockNumberHex, false]) as RpcEvmBlock | null
    : null;

  const rpcFrom = rpcTx.from?.toLowerCase() ?? rpcReceipt?.from?.toLowerCase() ?? '';
  const rpcTo = rpcTx.to?.toLowerCase() ?? rpcReceipt?.to?.toLowerCase() ?? '';
  const contractAddress = rpcReceipt?.contractAddress?.toLowerCase() ?? undefined;
  const blockHeight = parseIntSafe(hexToDec(blockNumberHex));
  const gasUsed = hexToDec(rpcReceipt?.gasUsed);
  const gasWanted = hexToDec(rpcTx.gas);
  const gasPriceWei = hexToDec(rpcReceipt?.effectiveGasPrice ?? rpcTx.gasPrice);
  const timestamp = hexTimestampToIso(rpcBlock?.timestamp);
  const cosmosFrom = evmToCosmos(rpcFrom) || undefined;
  const cosmosTo = evmToCosmos(rpcTo) || undefined;
  const inputData = rpcTx.input ?? undefined;
  const toForType = rpcTo || cosmosTo;

  return {
    hash: normalizedHash,
    evmHash: normalizedHash,
    blockHeight,
    fromAddr: cosmosFrom || rpcFrom,
    toAddr: cosmosTo || rpcTo || null,
    value: weiToUlitho(hexToDec(rpcTx.value)),
    tokenTransferAmount: decodeTransferAmount(inputData),
    denom: 'ulitho',
    feePaid: computeFeeUlitho(gasUsed, gasPriceWei) ?? '0',
    gasUsed: gasUsed !== '0' ? gasUsed : null,
    gasWanted: gasWanted !== '0' ? gasWanted : null,
    success: rpcReceipt ? rpcReceipt.status !== '0x0' : true,
    method: 'MsgTx',
    methodName: decodeMethodName(inputData),
    txType: classifyTxType(inputData, toForType, contractAddress),
    timestamp,
    contractAddress,
    nonce: parseHexInteger(rpcTx.nonce) ?? undefined,
    gasPrice: gasPriceWei !== '0' ? weiToUlitho(gasPriceWei) : undefined,
    inputData,
    evmFromAddr: rpcFrom || undefined,
    evmToAddr: rpcTo || undefined,
    cosmosFromAddr: cosmosFrom,
    cosmosToAddr: cosmosTo,
  };
}

// ── Mappers → Explorer-expected shapes ──────────────────────────────────────

function mapBlock(r: BlockRow) {
  return {
    height: Number(r.height),
    hash: r.hash,
    timestamp: r.block_time instanceof Date ? r.block_time.toISOString() : String(r.block_time),
    txCount: r.num_txs ?? 0,
    gasUsed: r.total_gas ?? '0',
  };
}

function mapBlockDetail(
  r: BlockRow,
  txs: Array<TxRow & { evm_hash?: string | null; evm_input_data?: string | null; evm_contract_address?: string | null; evm_from_address?: string | null; evm_to_address?: string | null; evm_value?: string | null; evm_gas_price?: string | null; evm_nonce?: number | null }>,
  options?: { txOffset?: number; txLimit?: number; txHasMore?: boolean; txFilteredCount?: number },
) {
  return {
    ...mapBlock(r),
    parentHash: null,
    proposerAddress: r.proposer_address ?? null,
    gasUsed: r.total_gas ?? '0',
    txs: txs.map((t) => mapTx(t, t.evm_hash, { input_data: t.evm_input_data, contract_address: t.evm_contract_address, from_address: t.evm_from_address, to_address: t.evm_to_address, value: t.evm_value, gas_price: t.evm_gas_price, nonce: t.evm_nonce })),
    txFilteredCount: options?.txFilteredCount ?? Number(r.num_txs ?? 0),
    txOffset: options?.txOffset ?? 0,
    txLimit: options?.txLimit ?? txs.length,
    txHasMore: options?.txHasMore ?? false,
  };
}

function mapTx(r: TxRow, evmHash?: string | null, evmExtra?: { input_data?: string | null | undefined; contract_address?: string | null | undefined; from_address?: string | null | undefined; to_address?: string | null | undefined; value?: string | null | undefined; gas_price?: string | null | undefined; nonce?: number | null | undefined }) {
  const safeHash = pickValidTxHash(r.hash, evmHash);
  const safeEvmHash = normalizeEvmTxHash(evmHash) ?? undefined;
  // Check if this is actually an EVM tx (has real EVM data, not just an empty join object)
  const hasEvmData = !!(evmExtra?.from_address || evmExtra?.to_address || evmExtra?.value || evmExtra?.input_data);
  const isEvmTx = r.tx_type === 'MsgEthereumTx' || hasEvmData;
  // Primary addresses are always litho1 (mainnet bech32). For EVM txs, derive from 0x address.
  // Never use r.receiver for EVM txs — it's the fee collector module, not the actual recipient.
  const fromAddr = isEvmTx
    ? (evmToCosmos(evmExtra?.from_address) || r.sender || evmExtra?.from_address || '')
    : (r.sender || evmExtra?.from_address || '');
  const toAddr = isEvmTx
    ? (evmToCosmos(evmExtra?.to_address) || evmExtra?.to_address || '')
    : (r.receiver || evmExtra?.to_address || '');
  let value = '0';
  if (isEvmTx && hasEvmData) {
    // Use EVM value (accurate msg.value in wei)
    const evmVal = weiToUlitho(evmExtra?.value);
    value = evmVal !== '0' ? evmVal : '0';
  } else if (r.amount && r.amount !== '0') {
    value = r.amount;
  }
  // For ERC-20 token transfers, try to decode the transfer amount from input data
  const tokenTransferAmount = decodeTransferAmount(evmExtra?.input_data);
  return {
    hash: safeHash ?? '',
    evmHash: safeEvmHash,
    blockHeight: Number(r.block_height),
    fromAddr,
    toAddr,
    value,
    tokenTransferAmount,
    denom: r.denom ?? 'ulitho',
    feePaid: r.fee ?? '0',
    gasUsed: r.gas_used ?? null,
    gasWanted: r.gas_wanted ?? null,
    success: r.success,
    method: cleanMethod(r.tx_type),
    methodName: decodeMethodName(evmExtra?.input_data),
    txType: classifyTxType(evmExtra?.input_data, toAddr, evmExtra?.contract_address),
    memo: r.memo ?? undefined,
    timestamp: r.timestamp instanceof Date ? r.timestamp.toISOString() : String(r.timestamp),
    rawLog: r.raw_log ?? undefined,
    inputData: evmExtra?.input_data ?? undefined,
    contractAddress: evmExtra?.contract_address ?? undefined,
    gasPrice: weiToUlitho(evmExtra?.gas_price) || undefined,
    nonce: evmExtra?.nonce ?? undefined,
    evmFromAddr: evmExtra?.from_address ?? undefined,
    evmToAddr: evmExtra?.to_address ?? undefined,
    // cosmosFromAddr/cosmosToAddr: only set when different from primary fromAddr/toAddr
    cosmosFromAddr: isEvmTx ? (evmToCosmos(evmExtra?.from_address) || undefined) : (r.sender?.startsWith('litho') ? r.sender : undefined),
    cosmosToAddr: isEvmTx ? (evmToCosmos(evmExtra?.to_address) || undefined) : (r.receiver?.startsWith('litho') ? r.receiver : undefined),
  };
}

async function enrichTokenInfo<T extends { tokenTransferAmount?: string | null; evmHash?: string; evmToAddr?: string; contractAddress?: string }>(mapped: T): Promise<T> {
  if (mapped.contractAddress) return mapped;

  // Primary: use token_transfers table — authoritative Transfer event data from receipt.
  // Covers faucet-style txs where the top-level input is not a bare ERC-20 transfer().
  // Pick the transfer with the largest value (most significant token moved).
  if (mapped.evmHash) {
    try {
      const ttRows = await query<{ contract_address: string; symbol: string | null; value: string }>(
        `SELECT tt.contract_address, c.symbol, tt.value
         FROM token_transfers tt
         LEFT JOIN contracts c ON LOWER(c.address) = LOWER(tt.contract_address)
         WHERE LOWER(tt.tx_hash) = LOWER($1)
         ORDER BY tt.value::numeric DESC, tt.log_index ASC
         LIMIT 1`,
        [mapped.evmHash]
      );
      if (ttRows[0]) {
        return {
          ...mapped,
          tokenTransferAmount: ttRows[0].value,
          tokenSymbol: ttRows[0].symbol ?? undefined,
          contractAddress: ttRows[0].contract_address,
        };
      }
    } catch { /* non-critical */ }
  }

  // Fallback: tokenTransferAmount was decoded from input_data by decodeTransferAmount;
  // look up the symbol by evmToAddr (= the token contract for a direct transfer() call).
  if (!mapped.tokenTransferAmount || !mapped.evmToAddr) return mapped;
  try {
    const rows = await query<{ symbol: string | null; name: string | null }>(
      `SELECT symbol, name FROM contracts WHERE LOWER(address) = LOWER($1) LIMIT 1`,
      [mapped.evmToAddr]
    );
    if (rows[0]?.symbol) {
      return { ...mapped, tokenSymbol: rows[0].symbol, contractAddress: mapped.evmToAddr };
    }
    // Not in the contracts table — the token is real on-chain but unindexed.
    // Read symbol()/name() live so the transfer shows a token name instead of a
    // bare hex pill. Falls through to contractAddress-only if the read fails.
    const meta = await fetchTokenMetaOnchain(mapped.evmToAddr);
    if (meta?.symbol) {
      return { ...mapped, tokenSymbol: meta.symbol, tokenName: meta.name, contractAddress: mapped.evmToAddr } as T;
    }
    // No symbol found but we know the contract — set contractAddress so the frontend
    // renders a contract link instead of falling back to the misleading "X LITHO" label.
    return { ...mapped, contractAddress: mapped.evmToAddr };
  } catch { /* non-critical */ }
  return { ...mapped, contractAddress: mapped.evmToAddr };
}

async function enrichTokenInfoBatch<
  T extends {
    tokenTransferAmount?: string | null;
    evmHash?: string;
    evmToAddr?: string;
    contractAddress?: string;
    tokenSymbol?: string;
  },
>(items: T[]): Promise<T[]> {
  if (items.length === 0) return items;

  const hashes = [...new Set(
    items
      .filter((item) => !item.contractAddress && item.evmHash)
      .map((item) => normalizeEvmTxHash(item.evmHash)?.toLowerCase())
      .filter((value): value is string => Boolean(value))
  )];

  const transferRows = hashes.length > 0
    ? await query<{ tx_hash: string; contract_address: string; symbol: string | null; value: string }>(
        `SELECT DISTINCT ON (LOWER(tt.tx_hash))
           LOWER(tt.tx_hash) AS tx_hash,
           tt.contract_address,
           c.symbol,
           tt.value
         FROM token_transfers tt
         LEFT JOIN contracts c ON LOWER(c.address) = LOWER(tt.contract_address)
         WHERE LOWER(tt.tx_hash) = ANY($1)
         ORDER BY LOWER(tt.tx_hash), tt.value::numeric DESC, tt.log_index ASC`,
        [hashes]
      ).catch(() => [])
    : [];

  const transferByHash = new Map(
    transferRows.map((row) => [
      row.tx_hash,
      {
        contractAddress: row.contract_address,
        tokenSymbol: row.symbol ?? undefined,
        tokenTransferAmount: row.value,
      },
    ])
  );

  const contractLookups = [...new Set(
    items
      .filter((item) => !item.contractAddress && item.tokenTransferAmount && item.evmToAddr)
      .map((item) => item.evmToAddr?.toLowerCase())
      .filter((value): value is string => Boolean(value))
  )];

  const contractRows = contractLookups.length > 0
    ? await query<{ address: string; symbol: string | null }>(
        `SELECT LOWER(address) AS address, symbol
         FROM contracts
         WHERE LOWER(address) = ANY($1)`,
        [contractLookups]
      ).catch(() => [])
    : [];

  const contractByAddress = new Map(contractRows.map((row) => [row.address, row.symbol ?? undefined]));

  return items.map((item) => {
    if (item.contractAddress) return item;

    const hashKey = item.evmHash ? normalizeEvmTxHash(item.evmHash)?.toLowerCase() : undefined;
    const transfer = hashKey ? transferByHash.get(hashKey) : undefined;
    if (transfer) {
      return {
        ...item,
        tokenTransferAmount: transfer.tokenTransferAmount,
        tokenSymbol: transfer.tokenSymbol,
        contractAddress: transfer.contractAddress,
      };
    }

    if (!item.tokenTransferAmount || !item.evmToAddr) return item;

    return {
      ...item,
      tokenSymbol: contractByAddress.get(item.evmToAddr.toLowerCase()) ?? item.tokenSymbol,
      contractAddress: item.evmToAddr,
    };
  });
}

function mapEvmTx(evm: EvmTxRow, cosmosTx?: TxRow) {
  const safeHash = pickValidTxHash(cosmosTx?.hash ?? evm.cosmos_tx_hash, evm.hash);
  const safeEvmHash = normalizeEvmTxHash(evm.hash) ?? undefined;
  const evmFrom = evm.from_address ?? '';
  const evmTo = evm.to_address ?? '';
  // Derive cosmos addresses from EVM addresses (don't use cosmosTx.receiver — that's the fee collector)
  const cosmosFrom = evmToCosmos(evmFrom) || cosmosTx?.sender || '';
  const cosmosTo = evmToCosmos(evmTo) || '';
  const tokenTransferAmount = decodeTransferAmount(evm.input_data);
  // For EVM value: use DB value (in wei), fall back to Cosmos amount only for non-EVM txs
  const evmValueUlitho = weiToUlitho(evm.value);
  // Compute fee from gas metrics (more accurate than Cosmos fee event for EVM txs)
  const gasPriceUlitho = weiToUlitho(evm.gas_price);
  const computedFee = computeFeeUlitho(evm.gas_used, evm.gas_price);
  return {
    hash: safeHash ?? '',
    evmHash: safeEvmHash,
    blockHeight: Number(evm.block_height),
    fromAddr: cosmosFrom || evmFrom,
    toAddr: cosmosTo || evmTo,
    value: evmValueUlitho !== '0' ? evmValueUlitho : '0',
    tokenTransferAmount,
    denom: cosmosTx?.denom ?? 'ulitho',
    feePaid: computedFee ?? cosmosTx?.fee ?? '0',
    gasUsed: evm.gas_used != null ? String(evm.gas_used) : cosmosTx?.gas_used ?? null,
    gasWanted: evm.gas_limit != null ? String(evm.gas_limit) : cosmosTx?.gas_wanted ?? null,
    success: evm.status,
    method: cleanMethod(cosmosTx?.tx_type) ?? 'MsgTx',
    methodName: decodeMethodName(evm.input_data),
    txType: classifyTxType(evm.input_data, evmTo || cosmosTo, evm.contract_address),
    memo: cosmosTx?.memo ?? undefined,
    timestamp: evm.timestamp instanceof Date ? evm.timestamp.toISOString() : String(evm.timestamp),
    contractAddress: evm.contract_address ?? undefined,
    nonce: evm.nonce ?? undefined,
    gasPrice: gasPriceUlitho !== '0' ? gasPriceUlitho : undefined,
    inputData: evm.input_data ?? undefined,
    evmFromAddr: evmFrom || undefined,
    evmToAddr: evmTo || undefined,
    cosmosFromAddr: cosmosFrom || undefined,
    cosmosToAddr: cosmosTo || undefined,
  };
}

function mapAddress(
  r: AccountRow,
  forms?: Pick<AddressForms, 'queryLower' | 'evmAddress' | 'cosmosAddress'>,
  balanceState?: Pick<NativeBalanceResolution, 'balance' | 'balanceSource'>
) {
  // If user queried by EVM address, show that as primary
  const isEvmQuery = forms?.queryLower?.startsWith('0x');
  const evmAddr = forms?.evmAddress ?? r.evm_address ?? (r.address.startsWith('0x') ? r.address : undefined);
  const cosmosAddr = forms?.cosmosAddress ?? (r.address.startsWith('litho') ? r.address : undefined);
  return {
    address: isEvmQuery && evmAddr ? evmAddr : (cosmosAddr ?? r.address),
    evmAddress: evmAddr ?? undefined,
    cosmosAddress: cosmosAddr ?? undefined,
    balance: balanceState?.balance ?? r.balance ?? '0',
    balanceSource: balanceState?.balanceSource ?? 'indexed',
    txCount: Number(r.tx_count ?? 0),
    lastSeen: r.updated_at instanceof Date ? r.updated_at.toISOString() : String(r.updated_at),
  };
}

const STATUS_LABELS: Record<number, string> = { 1: 'Unbonded', 2: 'Unbonding', 3: 'Bonded' };

function formatCommission(value: string | null | undefined) {
  try {
    const rate = parseFloat(value ?? '0');
    return (rate * 100).toFixed(2).replace(/\.?0+$/, '') + '%';
  } catch {
    return '0%';
  }
}

function mapValidator(r: ValidatorRow, includeMetrics = false) {
  // Preserve all 18 decimal places; sub-LITHO stake is not zero voting power.
  let votingPower = '0';
  try {
    const tokens = BigInt(r.tokens ?? '0');
    const litho = tokens / BigInt('1000000000000000000');
    const fraction = (tokens % BigInt('1000000000000000000')).toString().padStart(18, '0').replace(/0+$/, '');
    votingPower = litho.toLocaleString('en-US') + (fraction ? `.${fraction}` : '');
  } catch { /* keep 0 */ }

  // commission_rate is a Cosmos decimal string like "0.100000000000000000" → "10%"
  const commission = formatCommission(r.commission_rate);

  const result = {
    address: r.operator_address,
    moniker: r.moniker ?? r.operator_address.slice(0, 16) + '...',
    votingPower,
    commission,
    status: STATUS_LABELS[r.status] ?? 'Unknown',
  };
  if (!includeMetrics) return result;
  return {
    ...result,
    tokens: r.tokens ?? '0',
    uptimePercentage: finiteNumberOrNull(r.uptime_percentage),
    missedBlocks: r.missed_blocks_counter != null ? String(r.missed_blocks_counter) : null,
    jailed: Boolean(r.jailed),
    updatedAt: r.updated_at instanceof Date ? r.updated_at.toISOString() : r.updated_at ?? null,
  };
}

function finiteNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

// ── Router ──────────────────────────────────────────────────────────────────

export function explorerRouter(): Router {
  const r = Router();

  // Mainnet launches with all value-moving integrations disabled. Defaults
  // remain enabled for the existing Makalu deployment, while an explicit false
  // fails closed before any proxy/config route can expose testnet services.
  r.use('/faucet', (_req, res, next) => {
    if (process.env.FAUCET_ENABLED === 'false') {
      res.status(404).json({ ok: false, message: 'Faucet is not enabled on this network.' });
      return;
    }
    next();
  });
  r.use('/bridge', (_req, res, next) => {
    if (process.env.BRIDGE_ENABLED === 'false' || process.env.MULTX_ENABLED === 'false') {
      res.status(404).json({ ok: false, message: 'Bridge is not enabled on this network.' });
      return;
    }
    next();
  });

  // ── Stats summary (homepage) ────────────────────────────────────────────

  r.get('/stats/summary', async (_req: Request, res: Response) => {
    try {
      res.json(await getStatsSummaryResponse());
    } catch (err) {
      logger.error({ err: err instanceof Error ? err.message : String(err) }, '[api] /stats/summary error');
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ── Config (token info) ─────────────────────────────────────────────────

  r.get('/config', (_req: Request, res: Response) => {
    res.json({
      token: { symbol: 'LITHO', decimals: 18 },
      fiat: { symbol: 'USD', price: null, fetchedAt: null },
      network: {
        evmChainId: Number(process.env.LITHO_CHAIN_ID || '700777'),
        cosmosChainId: process.env.COSMOS_CHAIN_ID || process.env.CHAIN_ID || 'lithosphere_700777-2',
      },
      features: {
        faucet: process.env.FAUCET_ENABLED !== 'false',
        bridge: process.env.BRIDGE_ENABLED !== 'false' && process.env.MULTX_ENABLED !== 'false',
        swap: process.env.SWAP_ENABLED !== 'false' && Boolean(process.env.SWAP_ROUTER_ADDRESS?.trim()),
      },
    });
  });

  // ── Blocks ──────────────────────────────────────────────────────────────

  r.get('/blocks', async (req: Request, res: Response) => {
    try {
      const limit = clamp(req.query.limit);
      const offset = resolveOffset(req.query, limit);
      const rows = await query<BlockRow>(
        'SELECT * FROM blocks ORDER BY height DESC LIMIT $1 OFFSET $2',
        [limit, offset]
      );
      res.json(rows.map(mapBlock));
    } catch (err) {
      logger.error({ err: err instanceof Error ? err.message : String(err) }, '[api] /blocks error');
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  r.get('/blocks/:height', async (req: Request, res: Response) => {
    try {
      const { height } = req.params;
      const limit = clamp(req.query.limit, DEFAULT_LIMIT);
      const rawSearch = typeof req.query.q === 'string' ? req.query.q.trim().toLowerCase() : '';
      const rawStatus = typeof req.query.status === 'string' ? req.query.status.trim().toLowerCase() : '';
      const rawType = typeof req.query.type === 'string' ? req.query.type.trim().toLowerCase() : '';
      const statusFilter = rawStatus === 'success' ? true : rawStatus === 'failed' ? false : null;
      const typeFilter = rawType === 'transfer' || rawType === 'call' || rawType === 'create'
        ? rawType
        : null;
      const blocks = await query<BlockRow>(
        'SELECT * FROM blocks WHERE height = $1',
        [height]
      );
      if (!blocks[0]) {
        res.status(404).json({ message: 'Block not found' });
        return;
      }
      const totalTxs = Number(blocks[0].num_txs ?? 0);
      const whereClauses = ['t.block_height = $1'];
      const filterParams: unknown[] = [height];

      if (rawSearch) {
        filterParams.push(`%${rawSearch}%`);
        const searchIdx = filterParams.length;
        whereClauses.push(`(
          LOWER(t.hash) LIKE $${searchIdx}
          OR LOWER(COALESCE(e.hash, '')) LIKE $${searchIdx}
          OR LOWER(COALESCE(t.sender, '')) LIKE $${searchIdx}
          OR LOWER(COALESCE(t.receiver, '')) LIKE $${searchIdx}
          OR LOWER(COALESCE(e.from_address, '')) LIKE $${searchIdx}
          OR LOWER(COALESCE(e.to_address, '')) LIKE $${searchIdx}
          OR LOWER(COALESCE(t.memo, '')) LIKE $${searchIdx}
        )`);
      }

      if (statusFilter !== null) {
        filterParams.push(statusFilter);
        whereClauses.push(`t.success = $${filterParams.length}`);
      }

      if (typeFilter) {
        filterParams.push(typeFilter);
        whereClauses.push(`(
          CASE
            WHEN (COALESCE(e.to_address, '') = '' AND COALESCE(e.contract_address, '') <> '') THEN 'create'
            WHEN (COALESCE(e.input_data, '') <> '' AND e.input_data <> '0x' AND LENGTH(e.input_data) > 2) THEN 'call'
            ELSE 'transfer'
          END
        ) = $${filterParams.length}`);
      }

      const filtersActive = Boolean(rawSearch) || statusFilter !== null || Boolean(typeFilter);
      const filteredTxs = filtersActive
        ? await query<CountRow>(
            `SELECT COUNT(*) AS count
             FROM transactions t
             LEFT JOIN evm_transactions e ON e.cosmos_tx_hash = t.hash
             WHERE ${whereClauses.join(' AND ')}`,
            filterParams
          )
        : null;
      const filteredTxCount = filtersActive
        ? parseInt(filteredTxs?.[0]?.count ?? '0', 10)
        : totalTxs;
      const requestedOffset = resolveOffset(req.query, limit);
      const maxOffset = filteredTxCount > 0 ? Math.floor((filteredTxCount - 1) / limit) * limit : 0;
      const offset = Math.min(requestedOffset, maxOffset);
      const txs = await query<TxRow & { evm_hash: string | null; evm_input_data: string | null; evm_contract_address: string | null; evm_from_address: string | null; evm_to_address: string | null; evm_value: string | null; evm_gas_price: string | null; evm_nonce: number | null }>(
        `SELECT t.*, e.hash AS evm_hash, e.input_data AS evm_input_data, e.contract_address AS evm_contract_address, e.from_address AS evm_from_address, e.to_address AS evm_to_address, e.value AS evm_value, e.gas_price AS evm_gas_price, e.nonce AS evm_nonce
         FROM transactions t
         LEFT JOIN evm_transactions e ON e.cosmos_tx_hash = t.hash
         WHERE ${whereClauses.join(' AND ')}
         ORDER BY t.tx_index ASC
         LIMIT $${filterParams.length + 1} OFFSET $${filterParams.length + 2}`,
        [...filterParams, limit, offset]
      );
      const enrichedTxs = await enrichEvmRows(txs);
      const detail = mapBlockDetail(blocks[0], enrichedTxs, {
        txOffset: offset,
        txLimit: limit,
        txHasMore: offset + enrichedTxs.length < filteredTxCount,
        txFilteredCount: filteredTxCount,
      });

      // Block #1 is genesis. Surface chain_id / genesis_time from indexer_state
      // so the explorer can render a Genesis Information panel — block headers
      // themselves have no memo/chain field, but the network has well-known
      // genesis metadata that belongs naturally on block 1.
      if (Number(height) === 1) {
        const stateRows = await query<{ key: string; value: string }>(
          `SELECT key, value FROM indexer_state WHERE key IN ('chain_id', 'genesis_time', 'genesis_hash')`
        ).catch(() => []);
        const stateMap = Object.fromEntries(stateRows.map((row) => [row.key, row.value]));
        if (stateMap.chain_id)     (detail as Record<string, unknown>).chainId = stateMap.chain_id;
        if (stateMap.genesis_time) (detail as Record<string, unknown>).genesisTime = stateMap.genesis_time;
        if (stateMap.genesis_hash) (detail as Record<string, unknown>).genesisHash = stateMap.genesis_hash;
      }

      res.json(detail);
    } catch (err) {
      logger.error({ err: err instanceof Error ? err.message : String(err) }, '[api] /blocks/:height error');
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ── Transactions ────────────────────────────────────────────────────────

  r.get('/txs', async (req: Request, res: Response) => {
    try {
      const limit = clamp(req.query.limit);
      const offset = resolveOffset(req.query, limit);
      const [rows, total] = await Promise.all([
        query<TxRow & { evm_hash: string | null; evm_input_data: string | null; evm_contract_address: string | null; evm_from_address: string | null; evm_to_address: string | null; evm_value: string | null; evm_gas_price: string | null; evm_nonce: number | null }>(
          `SELECT t.*, e.hash AS evm_hash, e.input_data AS evm_input_data, e.contract_address AS evm_contract_address, e.from_address AS evm_from_address, e.to_address AS evm_to_address, e.value AS evm_value, e.gas_price AS evm_gas_price, e.nonce AS evm_nonce
           FROM transactions t
           LEFT JOIN evm_transactions e ON e.cosmos_tx_hash = t.hash
           ORDER BY t.timestamp DESC, t.block_height DESC
           LIMIT $1 OFFSET $2`,
          [limit, offset]
        ),
        getCachedCount('transactions-total', 'SELECT COUNT(*) AS count FROM transactions'),
      ]);

      const baseRows = rows.map((row) => {
        const evmExtra: EvmExtra = {
          input_data: row.evm_input_data,
          contract_address: row.evm_contract_address,
          from_address: row.evm_from_address,
          to_address: row.evm_to_address,
          value: row.evm_value,
          gas_price: row.evm_gas_price,
          nonce: row.evm_nonce,
        };
        return mapTx(row, row.evm_hash, evmExtra);
      });
      const enrichedRows = await enrichTokenInfoBatch(baseRows);

      res.json({
        txs: enrichedRows,
        total,
        limit,
        offset,
      });
    } catch (err) {
      logger.error({ err: err instanceof Error ? err.message : String(err) }, '[api] /txs error');
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  r.get('/txs/:hash', async (req: Request, res: Response) => {
    try {
      const { hash } = req.params;
      const normalizedEvmHash = normalizeEvmTxHash(hash);

      type TxJoinRow = TxRow & { evm_hash: string | null; evm_input_data: string | null; evm_contract_address: string | null; evm_from_address: string | null; evm_to_address: string | null; evm_value: string | null; evm_gas_price: string | null; evm_gas_used: number | null; evm_nonce: number | null };
      const txJoinSql = `SELECT t.*, e.hash AS evm_hash, e.input_data AS evm_input_data, e.contract_address AS evm_contract_address, e.from_address AS evm_from_address, e.to_address AS evm_to_address, e.value AS evm_value, e.gas_price AS evm_gas_price, e.gas_used AS evm_gas_used, e.nonce AS evm_nonce
         FROM transactions t
         LEFT JOIN evm_transactions e ON e.cosmos_tx_hash = t.hash`;

      // 1. Try exact match in transactions table (Cosmos SHA256 hash)
      const rows = await query<TxJoinRow>(
        `${txJoinSql} WHERE t.hash = $1`,
        [hash.toUpperCase()]
      );
      if (rows[0]) {
        let evmExtra: EvmExtra = { input_data: rows[0].evm_input_data, contract_address: rows[0].evm_contract_address, from_address: rows[0].evm_from_address, to_address: rows[0].evm_to_address, value: rows[0].evm_value, gas_price: rows[0].evm_gas_price, nonce: rows[0].evm_nonce };
        if (rows[0].evm_hash) evmExtra = await enrichEvmFromRpc(rows[0].evm_hash, evmExtra);
        const fee = computeFeeUlitho(rows[0].evm_gas_used ?? rows[0].gas_used, evmExtra.gas_price);
        const base1 = { ...mapTx(rows[0], rows[0].evm_hash, evmExtra), ...(fee ? { feePaid: fee } : {}) };
        res.json(await enrichTokenInfo(await recoverTxMemo(base1, rows[0].hash)));
        return;
      }

      // 2. Try case-insensitive match in transactions
      const rows2 = await query<TxJoinRow>(
        `${txJoinSql} WHERE LOWER(t.hash) = LOWER($1)`,
        [hash]
      );
      if (rows2[0]) {
        let evmExtra: EvmExtra = { input_data: rows2[0].evm_input_data, contract_address: rows2[0].evm_contract_address, from_address: rows2[0].evm_from_address, to_address: rows2[0].evm_to_address, value: rows2[0].evm_value, gas_price: rows2[0].evm_gas_price, nonce: rows2[0].evm_nonce };
        if (rows2[0].evm_hash) evmExtra = await enrichEvmFromRpc(rows2[0].evm_hash, evmExtra);
        const fee = computeFeeUlitho(rows2[0].evm_gas_used ?? rows2[0].gas_used, evmExtra.gas_price);
        const base2 = { ...mapTx(rows2[0], rows2[0].evm_hash, evmExtra), ...(fee ? { feePaid: fee } : {}) };
        res.json(await enrichTokenInfo(await recoverTxMemo(base2, rows2[0].hash)));
        return;
      }

      // 3. Try EVM tx hash lookup. Accept both 0x-prefixed and bare 64-char hashes.
      const evmRows = normalizedEvmHash
        ? await query<EvmTxRow>(
            'SELECT * FROM evm_transactions WHERE LOWER(hash) = LOWER($1)',
            [normalizedEvmHash]
          )
        : [];
      if (evmRows[0]) {
        // Enrich from RPC if value/gasPrice are missing or broken
        const evm = evmRows[0];
        const rpcEnriched = await enrichEvmFromRpc(evm.hash, { value: evm.value, gas_price: evm.gas_price, from_address: evm.from_address, to_address: evm.to_address, input_data: evm.input_data, contract_address: evm.contract_address, nonce: evm.nonce });
        const enrichedEvm: EvmTxRow = { ...evm, value: rpcEnriched.value ?? evm.value, gas_price: rpcEnriched.gas_price ?? evm.gas_price, from_address: rpcEnriched.from_address ?? evm.from_address, to_address: rpcEnriched.to_address ?? evm.to_address, input_data: rpcEnriched.input_data ?? evm.input_data, nonce: rpcEnriched.nonce ?? evm.nonce };
        // Get the linked Cosmos tx for full details
        const cosmosTx = await query<TxRow>(
          'SELECT * FROM transactions WHERE hash = $1',
          [evm.cosmos_tx_hash]
        );
        const mapped = mapEvmTx(enrichedEvm, cosmosTx[0]);
        // Compute fee from gasUsed * gasPrice
        const fee = computeFeeUlitho(enrichedEvm.gas_used, enrichedEvm.gas_price);
        const base3 = fee ? { ...mapped, feePaid: fee } : mapped;
        res.json(await enrichTokenInfo(await recoverTxMemo(base3, evm.cosmos_tx_hash)));
        return;
      }

      // 4. DB miss for a valid EVM hash: synthesize the tx directly from RPC so
      // older or not-yet-indexed EVM transactions still resolve in the explorer.
      if (normalizedEvmHash) {
        const rpcFallback = await buildRpcFallbackTx(normalizedEvmHash);
        if (rpcFallback) {
          res.json(rpcFallback);
          return;
        }
      }

      res.status(404).json({ message: 'Transaction not found' });
    } catch (err) {
      logger.error({ err: err instanceof Error ? err.message : String(err) }, '[api] /txs/:hash error');
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ── EVM Transaction Receipt (logs) ─────────────────────────────────────

  r.get('/txs/:hash/logs', async (req: Request, res: Response) => {
    try {
      const { hash } = req.params;
      const normalizedEvmHash = normalizeEvmTxHash(hash);

      // Resolve the EVM hash (user may pass Cosmos hash or EVM hash)
      let evmHash = normalizedEvmHash ?? hash;
      if (!normalizedEvmHash && !hash.startsWith('0x')) {
        // Try to find the EVM hash from the cosmos tx hash
        const evmRow = await query<{ hash: string }>(
          'SELECT hash FROM evm_transactions WHERE LOWER(cosmos_tx_hash) = LOWER($1)',
          [hash]
        );
        if (evmRow[0]) evmHash = evmRow[0].hash;
      }

      // Fetch receipt from EVM RPC
      if (!isEvmTxHash(evmHash)) {
        logger.warn({ evmHash: sanitizeForLog(evmHash) }, '[api] Skipping receipt lookup for malformed hash');
        res.json({ logs: [], raw: null });
        return;
      }

      const receipt = await evmRpcCall('eth_getTransactionReceipt', [evmHash]);
      if (!receipt) {
        res.json({ logs: [], raw: null });
        return;
      }

      const r2 = receipt as {
        logs?: Array<{
          address: string;
          topics: string[];
          data: string;
          logIndex: string;
          blockNumber: string;
          transactionIndex: string;
        }>;
        [key: string]: unknown;
      };

      // Decode log topics where possible
      const logs = (r2.logs ?? []).map((log, idx) => ({
        index: parseInt(log.logIndex, 16) || idx,
        address: log.address,
        topics: log.topics,
        data: log.data,
      }));

      res.json({ logs, raw: receipt });
    } catch (err) {
      logger.error({ err: err instanceof Error ? err.message : String(err) }, '[api] /txs/:hash/logs error');
      res.json({ logs: [], raw: null });
    }
  });

  // ── Address ─────────────────────────────────────────────────────────────

  r.get('/address/:address', async (req: Request, res: Response) => {
    try {
      const { address } = req.params;
      const initialForms = resolveAddressForms(address);

      // 1. Try accounts table (both cosmos and evm address columns)
      const rows = await query<AccountRow>(
        `SELECT * FROM accounts
         WHERE LOWER(address) = ANY($1) OR LOWER(evm_address) = ANY($1)
         LIMIT 1`,
        [initialForms.searchAddrs]
      );
      const forms = resolveAddressForms(address, rows[0] ?? null);
      if (rows[0]) {
        // Check if this address is a token contract
        const tokenInfo = await query<{
          name: string | null; symbol: string | null; decimals: number | null;
          total_supply: string | null; contract_type: string | null;
        }>(
          `SELECT name, symbol, decimals, total_supply, contract_type
           FROM contracts
           WHERE LOWER(address) = ANY($1)
           LIMIT 1`,
          [forms.contractSearchAddrs]
        ).catch(() => []);

        const balanceState = await resolveNativeBalance(forms.evmAddress, rows[0].balance);
        warnAddressBalanceFallback(forms.queryLower, balanceState, forms.evmAddress);

        const result: Record<string, unknown> = mapAddress(rows[0], forms, balanceState);
        if (tokenInfo[0]) {
          if (isHiddenToken({ symbol: tokenInfo[0].symbol, address: forms.evmAddress ?? forms.queryLower })) {
            res.status(404).json({ message: 'Address not found' });
            return;
          }
          result.isContract = true;
          result.isToken = !!(
            tokenInfo[0].symbol
            || tokenInfo[0].contract_type === 'token'
            || tokenInfo[0].contract_type === 'nft'
          );
          result.tokenName = tokenInfo[0].name;
          result.tokenSymbol = tokenInfo[0].symbol;
          result.tokenDecimals = tokenInfo[0].decimals ?? getDefaultTokenDecimals(tokenInfo[0].contract_type);
          result.totalSupply = tokenInfo[0].total_supply;
        }
        res.json(result);
        return;
      }

      // 2. Check if it's a known contract address
      const contractRows = await query<{
        address: string; name: string | null; symbol: string | null;
        decimals: number | null; total_supply: string | null; contract_type: string | null;
      }>(
        `SELECT address, name, symbol, decimals, total_supply, contract_type
         FROM contracts
         WHERE LOWER(address) = ANY($1)
         LIMIT 1`,
        [forms.contractSearchAddrs]
      ).catch(() => []);

      if (contractRows[0]) {
        const c = contractRows[0];
        if (isHiddenToken(c)) {
          res.status(404).json({ message: 'Address not found' });
          return;
        }
        const balanceState = await resolveNativeBalance(forms.evmAddress ?? c.address, null);
        warnAddressBalanceFallback(forms.queryLower, balanceState, forms.evmAddress ?? c.address);
        res.json({
          address: forms.queryLower.startsWith('0x') ? (forms.evmAddress ?? c.address) : (forms.cosmosAddress ?? c.address),
          evmAddress: forms.evmAddress ?? c.address,
          cosmosAddress: forms.cosmosAddress,
          balance: balanceState.balance,
          balanceSource: balanceState.balanceSource,
          txCount: 0,
          lastSeen: new Date().toISOString(),
          isContract: true,
          isToken: !!(c.symbol || c.contract_type === 'token' || c.contract_type === 'nft'),
          tokenName: c.name,
          tokenSymbol: c.symbol,
          tokenDecimals: c.decimals ?? getDefaultTokenDecimals(c.contract_type),
          totalSupply: c.total_supply,
        });
        return;
      }

      // 3. Build synthetic account from transactions (EVM addresses not yet in accounts table)
      const txCount = await query<CountRow>(
        `SELECT COUNT(*) AS count FROM (
           SELECT hash
           FROM transactions
           WHERE LOWER(sender) = ANY($1) OR LOWER(receiver) = ANY($1)
           UNION
           SELECT cosmos_tx_hash
           FROM evm_transactions
           WHERE LOWER(from_address) = ANY($1) OR LOWER(to_address) = ANY($1)
         ) combined`,
        [forms.searchAddrs]
      );

      const count = parseInt(txCount[0]?.count ?? '0');
      if (count > 0) {
        const [lastTx, balanceState] = await Promise.all([
          query<{ timestamp: Date | string | null }>(
            `SELECT MAX(timestamp) AS timestamp
             FROM (
               SELECT t.timestamp
               FROM transactions t
               WHERE LOWER(t.sender) = ANY($1) OR LOWER(t.receiver) = ANY($1)
               UNION ALL
               SELECT e.timestamp
               FROM evm_transactions e
               WHERE LOWER(e.from_address) = ANY($1) OR LOWER(e.to_address) = ANY($1)
             ) activity`,
            [forms.searchAddrs]
          ),
          resolveNativeBalance(forms.evmAddress ?? forms.queryLower, null),
        ]);
        warnAddressBalanceFallback(forms.queryLower, balanceState, forms.evmAddress ?? forms.queryLower);
        res.json({
          address: forms.queryLower.startsWith('0x')
            ? (forms.evmAddress ?? forms.queryLower)
            : (forms.cosmosAddress ?? forms.queryLower),
          evmAddress: forms.evmAddress,
          cosmosAddress: forms.cosmosAddress,
          balance: balanceState.balance,
          balanceSource: balanceState.balanceSource,
          txCount: count,
          lastSeen: toIsoString(lastTx[0]?.timestamp) ?? new Date().toISOString(),
        });
        return;
      }

      // 4. Check if this is a validator proposer address (CometBFT consensus hex)
      const proposerBlocks = await query<{ count: string; last_time: Date | null }>(
        `SELECT COUNT(*) AS count, MAX(block_time) AS last_time FROM blocks WHERE LOWER(proposer_address) = $1`,
        [forms.queryLower]
      ).catch(() => [{ count: '0', last_time: null }]);

      const blocksProposed = parseInt(proposerBlocks[0]?.count ?? '0');
      if (blocksProposed > 0) {
        res.json({
          address,
          balance: '0',
          balanceSource: 'unavailable',
          txCount: 0,
          blocksProposed,
          isValidator: true,
          lastSeen: proposerBlocks[0]?.last_time instanceof Date
            ? proposerBlocks[0].last_time.toISOString()
            : new Date().toISOString(),
        });
        return;
      }

      // 5. Valid EVM address with no indexed presence (no account, contract, txs
      //    or proposed blocks). A freshly-funded wallet has a real on-chain
      //    balance but no indexed activity yet, so resolve it live via RPC and
      //    return a synthetic zero-activity account instead of 404-ing. Only when
      //    the RPC actually answers (balanceSource 'rpc'); otherwise keep the 404.
      if (forms.evmAddress) {
        const balanceState = await resolveNativeBalance(forms.evmAddress, null);
        if (balanceState.balanceSource === 'rpc') {
          res.json({
            address: forms.queryLower.startsWith('0x') ? forms.evmAddress : (forms.cosmosAddress ?? forms.evmAddress),
            evmAddress: forms.evmAddress,
            cosmosAddress: forms.cosmosAddress,
            balance: balanceState.balance,
            balanceSource: balanceState.balanceSource,
            txCount: 0,
            lastSeen: new Date().toISOString(),
          });
          return;
        }
      }

      res.status(404).json({ message: 'Account not found' });
    } catch (err) {
      logger.error({ err: err instanceof Error ? err.message : String(err) }, '[api] /address/:address error');
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  r.get('/address/:address/txs', async (req: Request, res: Response) => {
    try {
      const { address } = req.params;
      const limit = clamp(req.query.limit, 25);
      const offset = resolveOffset(req.query, limit);
      const initialForms = resolveAddressForms(address);

      // Resolve linked addresses: if querying by 0x, also search by litho1... and vice versa
      const linkedAddrs = await query<AccountRow>(
        `SELECT * FROM accounts
         WHERE LOWER(address) = ANY($1) OR LOWER(evm_address) = ANY($1)
         LIMIT 1`,
        [initialForms.searchAddrs]
      ).catch(() => []);
      const forms = resolveAddressForms(address, linkedAddrs[0] ?? null);
      const addrs = forms.searchAddrs;

      const [countRows, rows] = await Promise.all([
        query<CountRow>(
          `SELECT COUNT(*) AS count
           FROM (
             SELECT DISTINCT t.hash
             FROM transactions t
             LEFT JOIN evm_transactions e ON e.cosmos_tx_hash = t.hash
             WHERE LOWER(t.sender) = ANY($1) OR LOWER(t.receiver) = ANY($1)
                OR LOWER(e.from_address) = ANY($1) OR LOWER(e.to_address) = ANY($1)
           ) matched`,
          [addrs]
        ),
        query<TxRow & {
          evm_hash: string | null;
          evm_input_data: string | null;
          evm_contract_address: string | null;
          evm_from_address: string | null;
          evm_to_address: string | null;
          evm_value: string | null;
          evm_gas_price: string | null;
          evm_nonce: number | null;
        }>(
          `SELECT * FROM (
             SELECT DISTINCT ON (t.hash)
               t.*,
               e.hash AS evm_hash,
               e.input_data AS evm_input_data,
               e.contract_address AS evm_contract_address,
               e.from_address AS evm_from_address,
               e.to_address AS evm_to_address,
               e.value AS evm_value,
               e.gas_price AS evm_gas_price,
               e.nonce AS evm_nonce
             FROM transactions t
             LEFT JOIN evm_transactions e ON e.cosmos_tx_hash = t.hash
             WHERE LOWER(t.sender) = ANY($1) OR LOWER(t.receiver) = ANY($1)
                OR LOWER(e.from_address) = ANY($1) OR LOWER(e.to_address) = ANY($1)
             ORDER BY t.hash, t.timestamp DESC
           ) sub
           ORDER BY sub.timestamp DESC
           LIMIT $2 OFFSET $3`,
          [addrs, limit, offset]
        ),
      ]);

      const enrichedRows = await enrichEvmRows(rows);
      const mappedRows = enrichedRows.map((row) => mapTx(row, row.evm_hash, {
        input_data: row.evm_input_data,
        contract_address: row.evm_contract_address,
        from_address: row.evm_from_address,
        to_address: row.evm_to_address,
        value: row.evm_value,
        gas_price: row.evm_gas_price,
        nonce: row.evm_nonce,
      }));
      const items = await enrichTokenInfoBatch(mappedRows);
      const total = parseInt(countRows[0]?.count ?? '0', 10);

      res.json({
        items,
        total,
        limit,
        offset,
        hasMore: offset + items.length < total,
      });
    } catch (err) {
      logger.error({ err: err instanceof Error ? err.message : String(err) }, '[api] /address/:address/txs error');
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  r.get('/address/:address/tokens', async (req: Request, res: Response) => {
    try {
      const { address } = req.params;
      const forms = resolveAddressForms(address);
      // Prefer EVM form for token_transfers lookup (stored as 0x addresses)
      const evmAddr = forms.evmAddress ?? forms.queryLower;

      const rows = await query<{
        contract_address: string;
        name: string | null;
        symbol: string | null;
        decimals: number | null;
        contract_type: string | null;
        balance: string;
      }>(
        `WITH flows AS (
           SELECT contract_address, value::numeric AS amt
           FROM token_transfers WHERE LOWER(to_address) = $1
           UNION ALL
           SELECT contract_address, -(value::numeric) AS amt
           FROM token_transfers WHERE LOWER(from_address) = $1
         ),
         balances AS (
           SELECT LOWER(contract_address) AS contract_address, SUM(amt) AS balance
           FROM flows
           GROUP BY LOWER(contract_address)
           HAVING SUM(amt) > 0
         )
         SELECT b.contract_address, c.name, c.symbol, c.decimals, c.contract_type, b.balance::text AS balance
         FROM balances b
         LEFT JOIN contracts c ON LOWER(c.address) = b.contract_address
         ORDER BY b.balance DESC`,
        [evmAddr.toLowerCase()]
      );

      res.json(rows.map((r) => ({
        contractAddress: r.contract_address,
        name: r.name ?? r.contract_address,
        symbol: r.symbol ?? '???',
        decimals: r.decimals ?? (r.contract_type === 'nft' ? 0 : 18),
        type: r.contract_type === 'nft' ? 'LEP100-6' : 'LEP100',
        balance: r.balance,
      })));
    } catch (err) {
      logger.error({ err: err instanceof Error ? err.message : String(err) }, '[api] /address/:address/tokens error');
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  r.get('/address/:address/token-transfers', async (req: Request, res: Response) => {
    try {
      const { address } = req.params;
      const limit = clamp(req.query.limit, 25);
      const offset = resolveOffset(req.query, limit);
      const forms = resolveAddressForms(address);
      const evmAddr = (forms.evmAddress ?? forms.queryLower).toLowerCase();

      const [rows, countResult] = await Promise.all([
        query<{
          tx_hash: string;
          from_address: string;
          to_address: string;
          value: string;
          token_id: string | null;
          block_height: string;
          timestamp: Date | null;
          contract_address: string;
          name: string | null;
          symbol: string | null;
          decimals: number | null;
          contract_type: string | null;
        }>(
          `SELECT tt.tx_hash, tt.from_address, tt.to_address, tt.value, tt.token_id,
                  tt.block_height, tt.timestamp, tt.contract_address,
                  c.name, c.symbol, c.decimals, c.contract_type
           FROM token_transfers tt
           LEFT JOIN contracts c ON LOWER(c.address) = LOWER(tt.contract_address)
           WHERE LOWER(tt.from_address) = $1 OR LOWER(tt.to_address) = $1
           ORDER BY tt.block_height DESC, tt.log_index DESC
           LIMIT $2 OFFSET $3`,
          [evmAddr, limit, offset]
        ),
        query<CountRow>(
          `SELECT COUNT(*) AS count FROM token_transfers
           WHERE LOWER(from_address) = $1 OR LOWER(to_address) = $1`,
          [evmAddr]
        ),
      ]);

      const total = parseInt(countResult[0]?.count ?? '0', 10);
      res.json({
        items: rows.map((r) => ({
          txHash: r.tx_hash,
          fromAddress: r.from_address,
          toAddress: r.to_address,
          value: r.value,
          tokenId: r.token_id ?? null,
          blockHeight: r.block_height,
          timestamp: r.timestamp ? toIsoString(r.timestamp) : null,
          contractAddress: r.contract_address,
          tokenName: r.name ?? r.contract_address,
          tokenSymbol: r.symbol ?? '???',
          decimals: r.decimals ?? (r.contract_type === 'nft' ? 0 : 18),
          type: r.contract_type === 'nft' ? 'LEP100-6' : 'LEP100',
        })),
        total,
        limit,
        offset,
        hasMore: offset + rows.length < total,
      });
    } catch (err) {
      logger.error({ err: err instanceof Error ? err.message : String(err) }, '[api] /address/:address/token-transfers error');
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ── Validators ──────────────────────────────────────────────────────────

  r.get('/validators/:operatorAddress/avatar', async (req: Request, res: Response) => {
    try {
      const rows = await query<Pick<ValidatorRow, 'identity'>>(
        'SELECT identity FROM validators WHERE operator_address = $1',
        [req.params.operatorAddress]
      );
      const identity = rows[0]?.identity?.trim();
      if (!identity || !/^[a-zA-Z0-9_-]{3,64}$/.test(identity)) {
        res.status(404).end();
        return;
      }

      const response = await fetch(
        `https://keybase.io/_/api/1.0/user/lookup.json?key_fingerprint=${encodeURIComponent(identity)}`,
        { signal: AbortSignal.timeout(5_000) }
      );
      if (!response.ok) {
        res.status(404).end();
        return;
      }
      const body = await response.json() as {
        them?: Array<{ pictures?: { primary?: { url?: string } } }>;
      };
      const picture = body.them?.[0]?.pictures?.primary?.url;
      if (!picture) {
        res.status(404).end();
        return;
      }
      const pictureUrl = new URL(picture);
      if (pictureUrl.protocol !== 'https:') {
        res.status(404).end();
        return;
      }
      res.setHeader('Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400');
      res.redirect(302, pictureUrl.toString());
    } catch {
      res.status(404).end();
    }
  });

  r.get('/validators/:operatorAddress', async (req: Request, res: Response) => {
    try {
      const rows = await query<ValidatorRow>(
        `SELECT v.*,
                (SELECT COUNT(*) + 1 FROM validators ranked WHERE ranked.tokens::numeric > v.tokens::numeric) AS rank,
                (SELECT COALESCE(SUM(tokens::numeric), 0) FROM validators WHERE status = 3 AND jailed = FALSE)::text AS total_bonded_tokens
           FROM validators v
          WHERE v.operator_address = $1`,
        [req.params.operatorAddress]
      );
      const validator = rows[0];
      if (!validator) {
        res.status(404).json({ message: 'Validator not found' });
        return;
      }
      res.json({
        ...mapValidator(validator),
        consensusAddress: validator.consensus_address ?? null,
        identity: validator.identity ?? null,
        website: validator.website ?? null,
        securityContact: validator.security_contact ?? null,
        details: validator.details ?? null,
        tokens: validator.tokens ?? '0',
        delegatorShares: validator.delegator_shares ?? '0',
        minSelfDelegation: validator.min_self_delegation ?? '0',
        commissionMaxRate: formatCommission(validator.commission_max_rate),
        commissionMaxChange: formatCommission(validator.commission_max_change),
        jailed: Boolean(validator.jailed),
        uptimePercentage: finiteNumberOrNull(validator.uptime_percentage),
        missedBlocks: validator.missed_blocks_counter != null
          ? String(validator.missed_blocks_counter)
          : null,
        updatedAt: validator.updated_at instanceof Date
          ? validator.updated_at.toISOString()
          : validator.updated_at ?? null,
        rank: Number(validator.rank ?? 0),
        votingPowerPercentage: Number(validator.total_bonded_tokens ?? 0) > 0
          ? Number(((Number(validator.tokens) / Number(validator.total_bonded_tokens)) * 100).toFixed(2))
          : 0,
        profileImageUrl: validator.identity
          ? `/api/validators/${encodeURIComponent(validator.operator_address)}/avatar`
          : null,
      });
    } catch (err) {
      logger.error({ err: err instanceof Error ? err.message : String(err) }, '[api] /validators/:operatorAddress error');
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  r.get('/validators', async (req: Request, res: Response) => {
    try {
      const search = typeof req.query.search === 'string' ? req.query.search.trim().slice(0, 100) : '';
      const sector = typeof req.query.sector === 'string' ? req.query.sector : '';
      const sort = typeof req.query.sort === 'string' ? req.query.sort : 'tokens';
      const orderBy = sector === 'uptime' || sort === 'uptime'
        ? 'uptime_percentage DESC NULLS LAST, tokens::numeric DESC NULLS LAST, operator_address ASC'
        : sort === 'commission'
          ? 'commission_rate::numeric ASC NULLS LAST, tokens::numeric DESC NULLS LAST, operator_address ASC'
          : sort === 'missed'
            ? 'missed_blocks_counter ASC NULLS LAST, tokens::numeric DESC NULLS LAST, operator_address ASC'
            : 'tokens::numeric DESC NULLS LAST, operator_address ASC';
      const where: string[] = [];
      const params: string[] = [];
      if (search) {
        params.push(`%${search}%`);
        where.push(`(moniker ILIKE $${params.length} OR operator_address ILIKE $${params.length})`);
      }
      if (req.query.status === 'active') where.push('status = 3 AND jailed = FALSE');
      if (req.query.status === 'inactive') where.push('(status <> 3 OR jailed = TRUE)');
      const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
      const rows = await query<ValidatorRow>(
        `SELECT * FROM validators ${whereSql} ORDER BY ${orderBy} LIMIT 100`,
        params
      );
      res.json(rows.map((row) => mapValidator(row, req.query.metrics === '1')));
    } catch (err) {
      logger.error({ err: err instanceof Error ? err.message : String(err) }, '[api] /validators error');
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ── Tokens ─────────────────────────────────────────────────────────

  r.get('/tokens', async (_req: Request, res: Response) => {
    try {
      // Query contracts table for deployed tokens, fall back to known tokens
      const contractTokens = await query<{
        address: string;
        name: string | null;
        symbol: string | null;
        decimals: number | null;
        total_supply: string | null;
        contract_type: string | null;
        creator: string | null;
        created_at: Date;
      }>(
        // Dedupe by lower(address): the same contract can exist as two rows that
        // differ only by EVM-address casing — a checksummed seeded row and a
        // lowercased indexer-detected row. Collapse them with DISTINCT ON, keeping
        // the checksummed (seeded) row, which carries the canonical name/symbol.
        `SELECT address, name, symbol, decimals, total_supply, contract_type, creator, created_at
         FROM (
           SELECT DISTINCT ON (lower(address))
                  address, name, symbol, decimals, total_supply, contract_type, creator, created_at
           FROM contracts
           WHERE contract_type = 'token' OR (symbol IS NOT NULL AND contract_type IS DISTINCT FROM 'nft')
           ORDER BY lower(address), (address = lower(address)), created_at ASC
         ) deduped
         ORDER BY created_at DESC
         LIMIT 100`
      ).catch(() => []);

      // Native LITHO holders = addresses with a non-zero current balance (kept
      // warm by the indexer's eth_getBalance sweep). The old query unioned every
      // address that ever sent/received, which counted historical participants.
      const [holderCount, totalTxCount, tokenTransferIndex] = await Promise.all([
        query<CountRow>(
          `SELECT COUNT(*) AS count FROM accounts WHERE balance IS NOT NULL AND balance <> '0'`
        ).catch(() => [{ count: '0' }]),
        query<CountRow>('SELECT COUNT(*) AS count FROM transactions').catch(() => [{ count: '0' }]),
        getTokenTransferIndexStatus(),
      ]);
      const tokenStatsByAddress = tokenTransferIndex.ready
        ? await loadCached('token-stats-by-contract', 30_000, getTokenStatsByContract)
        : new Map<string, { holders: number; transfers: number }>();

      const visibleContractTokens = contractTokens.filter((token) => !isHiddenToken(token));

      const tokens = [
        {
          symbol: 'LITHO',
          name: 'Lithosphere',
          decimals: 18,
          totalSupply: '1000000000000000000000000000',
          type: 'native',
          holders: parseInt(holderCount[0]?.count ?? '0'),
          transfers: parseInt(totalTxCount[0]?.count ?? '0'),
          contractAddress: null,
        },
        ...visibleContractTokens.map((c) => {
          const type = getAssetType(c.contract_type, c.symbol);
          const isFungible = isFungibleContractType(c.contract_type, c.symbol);
          const stats = isFungible ? tokenStatsByAddress.get(c.address.toLowerCase()) : null;
          return {
            symbol: c.symbol ?? 'Unknown',
            name: c.name ?? 'Unknown Token',
            decimals: c.decimals ?? getDefaultTokenDecimals(c.contract_type),
            totalSupply: c.total_supply,
            type,
            holders: isFungible && tokenTransferIndex.ready ? (stats?.holders ?? 0) : null,
            transfers: isFungible && tokenTransferIndex.ready ? (stats?.transfers ?? 0) : null,
            contractAddress: c.address,
          };
        }),
      ];

      res.json(tokens);
    } catch (err) {
      logger.error({ err: err instanceof Error ? err.message : String(err) }, '[api] /tokens error');
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ── NFT collections (LEP100-6 / ERC-721) ────────────────────────────
  // Lists every contract classified as an NFT collection by the indexer
  // (contract_type='nft'), with current-owner holder counts, item counts,
  // and transfer counts. Powers the explorer's /nfts page.

  r.get('/nfts', async (_req: Request, res: Response) => {
    try {
      const [collections, stats] = await Promise.all([
        query<{
          address: string;
          name: string | null;
          symbol: string | null;
          total_supply: string | null;
          creator: string | null;
          created_at: Date;
        }>(
          `SELECT address, name, symbol, total_supply, creator, created_at
           FROM contracts
           WHERE contract_type = 'nft'
           ORDER BY created_at DESC
           LIMIT 100`
        ).catch(() => []),
        getNftStatsByContract(),
      ]);

      const nfts = collections
        .filter((c) => !isHiddenToken({ address: c.address, symbol: c.symbol }))
        .map((c) => {
          const s = stats.get(c.address.toLowerCase());
          return {
            contractAddress: c.address,
            name: c.name ?? 'Unknown Collection',
            symbol: c.symbol ?? 'NFT',
            type: 'LEP100-6' as const,
            standard: 'LEP100-6',
            items: s?.items ?? 0,
            holders: s?.holders ?? 0,
            transfers: s?.transfers ?? 0,
            totalSupply: c.total_supply,
            creator: c.creator,
            createdAt: c.created_at instanceof Date
              ? c.created_at.toISOString()
              : (c.created_at ? String(c.created_at) : null),
          };
        });

      res.json(nfts);
    } catch (err) {
      logger.error({ err: err instanceof Error ? err.message : String(err) }, '[api] /nfts error');
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ── Recent NFT transfers across all collections ─────────────────────

  r.get('/nfts/transfers', async (req: Request, res: Response) => {
    try {
      const limit = clamp(req.query.limit, 25);
      const offset = resolveOffset(req.query, limit);
      const [rows, countResult] = await Promise.all([
        query<{
          tx_hash: string;
          contract_address: string;
          from_address: string;
          to_address: string;
          token_id: string | null;
          block_height: string;
          timestamp: Date;
          name: string | null;
          symbol: string | null;
        }>(
          `SELECT tt.tx_hash, tt.contract_address, tt.from_address, tt.to_address,
                  tt.token_id, tt.block_height, tt.timestamp, c.name, c.symbol
           FROM token_transfers tt
           LEFT JOIN contracts c ON LOWER(c.address) = LOWER(tt.contract_address)
           WHERE tt.token_id IS NOT NULL
           ORDER BY tt.block_height DESC, tt.log_index DESC
           LIMIT $1 OFFSET $2`,
          [limit, offset]
        ).catch(() => []),
        query<CountRow>(
          `SELECT COUNT(*) AS count FROM token_transfers WHERE token_id IS NOT NULL`
        ).catch(() => [{ count: '0' }]),
      ]);

      res.json({
        transfers: rows.map((r) => ({
          txHash: pickValidTxHash(r.tx_hash) ?? '',
          contractAddress: r.contract_address,
          collectionName: r.name ?? null,
          collectionSymbol: r.symbol ?? null,
          fromAddress: r.from_address,
          toAddress: r.to_address,
          tokenId: r.token_id ?? null,
          blockHeight: Number(r.block_height),
          timestamp: r.timestamp instanceof Date ? r.timestamp.toISOString() : String(r.timestamp),
        })),
        total: parseInt(countResult[0]?.count ?? '0'),
        limit,
        offset,
      });
    } catch (err) {
      logger.error({ err: err instanceof Error ? err.message : String(err) }, '[api] /nfts/transfers error');
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ── Token detail by contract address (or "native" for LITHO) ────────

  r.get('/tokens/:address', async (req: Request, res: Response) => {
    try {
      // Accept the Lithosphere bech32 form as well as 0x — the explorer links
      // contracts by their litho1 identity.
      const address = normalizeContractAddress(req.params.address);

      // Native LITHO token
      if (address === 'native') {
        const [holderCount, totalTxCount] = await Promise.all([
          // Current owners: non-zero native balance (warmed by the indexer sweep),
          // not the historical set of every address that ever transacted.
          query<CountRow>(
            `SELECT COUNT(*) AS count FROM accounts WHERE balance IS NOT NULL AND balance <> '0'`
          ).catch(() => [{ count: '0' }]),
          query<CountRow>('SELECT COUNT(*) AS count FROM transactions').catch(() => [{ count: '0' }]),
        ]);
        res.json({
          address: 'native',
          name: 'Lithosphere',
          symbol: 'LITHO',
          decimals: 18,
          totalSupply: '1000000000000000000000000000',
          type: 'native',
          creator: null,
          creationTx: null,
          creationBlock: 1,
          createdAt: null,
          holders: parseInt(holderCount[0]?.count ?? '0'),
          transfers: parseInt(totalTxCount[0]?.count ?? '0'),
          contractAddress: null,
          standard: 'Native',
          description: 'Native staking and gas token of the Lithosphere network. Used for transaction fees, staking, and governance.',
          verified: true,
        });
        return;
      }

      // LEP100 token by contract address
      const addrLower = address.toLowerCase();
      const rows = await query<{
        address: string; name: string | null; symbol: string | null;
        decimals: number | null; total_supply: string | null;
        contract_type: string | null; creator: string | null;
        creation_tx: string | null; creation_block: string | null;
        verified: boolean | null; created_at: Date;
      }>(
        `SELECT address, name, symbol, decimals, total_supply, contract_type, creator,
                creation_tx, creation_block, verified, created_at
         FROM contracts WHERE LOWER(address) = $1`,
        [addrLower]
      );

      if (!rows[0]) {
        res.status(404).json({ message: 'Token contract not found' });
        return;
      }

      const c = rows[0];
      if (isHiddenToken(c)) {
        res.status(404).json({ message: 'Token contract not found' });
        return;
      }
      const assetType = getAssetType(c.contract_type, c.symbol);
      const isFungible = isFungibleContractType(c.contract_type, c.symbol);
      const tokenTransferIndex = isFungible
        ? await getTokenTransferIndexStatus()
        : { evmTxCount: 0, transferCount: 0, ready: false };
      const ZERO_ADDR = '0x0000000000000000000000000000000000000000';
      const [holderCount, transferCount] = isFungible && tokenTransferIndex.ready
        ? await Promise.all([
            query<CountRow>(
              `SELECT COUNT(DISTINCT addr) AS count FROM (
                 SELECT from_address AS addr FROM token_transfers WHERE LOWER(contract_address) = $1
                 UNION
                 SELECT to_address   AS addr FROM token_transfers WHERE LOWER(contract_address) = $1
               ) h WHERE addr != $2`,
              [addrLower, ZERO_ADDR]
            ).catch(() => [{ count: '0' }]),
            query<CountRow>(
              `SELECT COUNT(*) AS count FROM token_transfers WHERE LOWER(contract_address) = $1`,
              [addrLower]
            ).catch(() => [{ count: '0' }]),
          ])
        : [[{ count: '0' }], [{ count: '0' }]];

      res.json({
        address: c.address,
        name: c.name ?? 'Unknown Token',
        symbol: c.symbol ?? 'Unknown',
        decimals: c.decimals ?? getDefaultTokenDecimals(c.contract_type),
        totalSupply: c.total_supply,
        type: assetType,
        creator: c.creator,
        creationTx: pickValidTxHash(c.creation_tx) ?? null,
        creationBlock: c.creation_block ? parseInt(c.creation_block) : null,
        createdAt: c.created_at instanceof Date ? c.created_at.toISOString() : String(c.created_at),
        holders: isFungible && tokenTransferIndex.ready ? parseInt(holderCount[0]?.count ?? '0') : null,
        transfers: isFungible && tokenTransferIndex.ready ? parseInt(transferCount[0]?.count ?? '0') : null,
        contractAddress: c.address,
        standard: getAssetStandard(assetType),
        description: null,
        verified: c.verified ?? false,
      });
    } catch (err) {
      logger.error({ err: err instanceof Error ? err.message : String(err) }, '[api] /tokens/:address error');
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ── Token roles (AccessControl RoleGranted events) ────────────────

  r.get('/tokens/:address/roles', async (req: Request, res: Response) => {
    try {
      const address = normalizeContractAddress(req.params.address);
      if (isHiddenToken({ address })) {
        res.status(404).json({ message: 'Token contract not found' });
        return;
      }
      if (address === 'native' || !address.startsWith('0x') || EVM_RPC_ENDPOINTS.length === 0) {
        res.json({ roles: [] });
        return;
      }

      // RoleGranted(bytes32 role, address account, address sender)
      const ROLE_GRANTED_TOPIC = '0x2f8788117e7eff1d82e926ec794901d17c78024a50270940304540a733656f0d';
      // Known role hashes → human-readable names
      const ROLE_NAMES: Record<string, string> = {
        '0x0000000000000000000000000000000000000000000000000000000000000000': 'DEFAULT_ADMIN',
        '0x65d7a28e3265b37a6474929f336521b332c1681b933f6cb9f3376673440d862a': 'PAUSE',
        '0x2fc10cc8ae19568712f7a176fb4978616a610650813c9d05326c34abb62749c7': 'UNPAUSE',
        '0x9f2df0fed2c77648de5860a4cc508cd0818c85b8b8a1ab4ceeef8d981c8956a6': 'MINTER',
        '0x3c11d16cbaffd01df69ce1c404f6340ee057498f5f00246190ea54220576a848': 'BURNER',
        '0x7804d923f43a17d325d77e781528e0793b2edd9890ab45fc64efd7b4b427744c': 'ISSUER',
        '0xb5a7cd0579e9a9d0e9b0b3adcfa0b5e9cc1e4a15f57b55d4b14a3a9a3e4bc12d': 'BURN_BLOCKED',
      };

      const logs = await evmRpcCall('eth_getLogs', [{
        fromBlock: '0x0',
        toBlock: 'latest',
        address: address,
        topics: [ROLE_GRANTED_TOPIC],
      }]) as Array<{ topics: string[]; data: string; blockNumber: string; transactionHash: string }> | null;

      if (!logs || !Array.isArray(logs)) {
        res.json({ roles: [] });
        return;
      }

      const roles = logs.map((log) => {
        const roleHash = log.topics[1] ?? '';
        const accountHex = log.topics[2] ?? '';
        const account = '0x' + accountHex.slice(26); // last 20 bytes
        const block = Number(BigInt(log.blockNumber));
        return {
          role: ROLE_NAMES[roleHash] ?? roleHash.slice(0, 10) + '...',
          roleHash,
          account: account.toLowerCase(),
          block,
          txHash: pickValidTxHash(log.transactionHash) ?? '',
        };
      });

      res.json({ roles });
    } catch (err) {
      logger.error({ err: err instanceof Error ? err.message : String(err) }, '[api] /tokens/:address/roles error');
      res.json({ roles: [] });
    }
  });

  // ── Token transfers list ──────────────────────────────────────────

  r.get('/tokens/:address/transfers', async (req: Request, res: Response) => {
    try {
      const address = normalizeContractAddress(req.params.address);
      const limit = clamp(req.query.limit, 25);
      const offset = resolveOffset(req.query, limit);
      if (isHiddenToken({ address })) {
        res.status(404).json({ message: 'Token contract not found' });
        return;
      }

      if (address === 'native') {
        // Native LITHO: all chain transactions
        const [rows, countResult] = await Promise.all([
          query<{ hash: string; sender: string | null; receiver: string | null; amount: string | null; block_height: string; timestamp: Date; evm_hash: string | null; evm_from: string | null; evm_to: string | null; evm_value: string | null; evm_gas_price: string | null; evm_nonce: number | null; evm_input_data: string | null; evm_contract_address: string | null }>(
            `SELECT t.hash, t.sender, t.receiver, t.amount, t.block_height, t.timestamp,
                    e.hash AS evm_hash, e.from_address AS evm_from, e.to_address AS evm_to, e.value AS evm_value,
                    e.gas_price AS evm_gas_price, e.nonce AS evm_nonce, e.input_data AS evm_input_data, e.contract_address AS evm_contract_address
             FROM transactions t LEFT JOIN evm_transactions e ON e.cosmos_tx_hash = t.hash
             ORDER BY t.block_height DESC LIMIT $1 OFFSET $2`,
            [limit, offset]
          ),
          query<CountRow>('SELECT COUNT(*) AS count FROM transactions'),
        ]);

        const enrichedRows = await Promise.all(rows.map(async (r) => {
          let evmExtra: EvmExtra = {
            input_data: r.evm_input_data, contract_address: r.evm_contract_address,
            from_address: r.evm_from, to_address: r.evm_to,
            value: r.evm_value, gas_price: r.evm_gas_price, nonce: r.evm_nonce
          };
          // Evm txs without native value (e.g failed to be loaded) or value = 0.
          if (r.evm_hash) evmExtra = await enrichEvmFromRpc(r.evm_hash, evmExtra);
          
          let finalValue = '0';
          if (r.evm_hash || r.evm_from) {
            // For EVM transactions, strictly use the enriched EVM value (wei mapped to ulitho)
            const evmVal = weiToUlitho(evmExtra.value);
            finalValue = evmVal !== '0' ? evmVal : '0';
          } else if (r.amount && r.amount !== '0') {
            // For pure Cosmos transactions (no EVM binding), use the amount
            finalValue = r.amount;
          }

          return {
            txHash: pickValidTxHash(r.hash, r.evm_hash) ?? '',
            fromAddress: (r.evm_hash || r.evm_from) ? (evmToCosmos(evmExtra.from_address) || r.sender || evmExtra.from_address || '') : (r.sender || evmExtra.from_address || ''),
            toAddress: (r.evm_hash || r.evm_from) ? (evmToCosmos(evmExtra.to_address) || evmExtra.to_address || '') : (r.receiver || evmExtra.to_address || ''),
            value: finalValue,
            blockHeight: Number(r.block_height),
            timestamp: r.timestamp instanceof Date ? r.timestamp.toISOString() : String(r.timestamp),
          };
        }));

        res.json({
          transfers: enrichedRows,
          total: parseInt(countResult[0]?.count ?? '0'),
          limit,
          offset,
        });
      } else {
        // LEP100/ERC-721: Transfer events from token_transfers (indexed from EVM logs)
        const addrLower = address.toLowerCase();
        const [rows, countResult] = await Promise.all([
          query<{ tx_hash: string; from_address: string; to_address: string; value: string; token_id: string | null; block_height: string; timestamp: Date }>(
            `SELECT tx_hash, from_address, to_address, value, token_id, block_height, timestamp
             FROM token_transfers
             WHERE LOWER(contract_address) = $1
             ORDER BY block_height DESC, log_index DESC
             LIMIT $2 OFFSET $3`,
            [addrLower, limit, offset]
          ),
          query<CountRow>(
            `SELECT COUNT(*) AS count FROM token_transfers WHERE LOWER(contract_address) = $1`,
            [addrLower]
          ),
        ]);
        res.json({
          transfers: rows.map((r) => ({
            txHash: pickValidTxHash(r.tx_hash) ?? '',
            fromAddress: r.from_address,
            toAddress: r.to_address,
            value: r.value,
            tokenId: r.token_id ?? null,
            blockHeight: Number(r.block_height),
            timestamp: r.timestamp instanceof Date ? r.timestamp.toISOString() : String(r.timestamp),
          })),
          total: parseInt(countResult[0]?.count ?? '0'),
          limit,
          offset,
        });
      }
    } catch (err) {
      logger.error({ err: err instanceof Error ? err.message : String(err) }, '[api] /tokens/:address/transfers error');
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ── Token holders list ────────────────────────────────────────────

  r.get('/tokens/:address/holders', async (req: Request, res: Response) => {
    try {
      const address = normalizeContractAddress(req.params.address);
      const limit = clamp(req.query.limit, 25);
      const offset = resolveOffset(req.query, limit);
      if (isHiddenToken({ address })) {
        res.status(404).json({ message: 'Token contract not found' });
        return;
      }

      if (address === 'native') {
        // Native LITHO holders read from accounts.balance, kept warm by the
        // indexer's eth_getBalance sweep. Only non-zero balances are real holders,
        // so the list, its total, and ranking all come from the same source as the
        // headline holder count (no per-row live RPC, no historical-participant rows).
        const totalSupplyWei = 1_000_000_000e18; // 1B LITHO in wei
        const [rows, countResult] = await Promise.all([
          query<{ address: string; evm_address: string | null; balance: string }>(
            `SELECT address, evm_address, balance
               FROM accounts
              WHERE balance IS NOT NULL AND balance <> '0'
              ORDER BY balance::numeric DESC
              LIMIT $1 OFFSET $2`,
            [limit, offset]
          ).catch(() => []),
          query<CountRow>(
            `SELECT COUNT(*) AS count FROM accounts WHERE balance IS NOT NULL AND balance <> '0'`
          ).catch(() => [{ count: '0' }]),
        ]);

        const holders = rows.map((r) => {
          const balUlitho = weiToUlitho(r.balance);
          return {
            address: r.evm_address || r.address,
            balance: balUlitho,
            percentage: totalSupplyWei > 0 ? (parseFloat(r.balance) / totalSupplyWei) * 100 : 0,
          };
        });

        res.json({
          holders,
          total: parseInt(countResult[0]?.count ?? '0'),
          limit,
          offset,
        });
      } else {
        // LEP100: derive holder balances from indexed Transfer events
        // balance(addr) = Σ value where to = addr − Σ value where from = addr
        // Uses NUMERIC(78,0) for exact big-int aggregation.
        const addrLower = address.toLowerCase();
        const ZERO_ADDR = '0x0000000000000000000000000000000000000000';

        const [supplyRow] = await query<{ total_supply: string | null }>(
          `SELECT total_supply FROM contracts WHERE LOWER(address) = $1`,
          [addrLower]
        ).catch(() => [{ total_supply: null }]);
        const totalSupplyStr = supplyRow?.total_supply ?? '0';

        const [rows, countResult] = await Promise.all([
          query<{ address: string; balance: string }>(
            `WITH flows AS (
               SELECT to_address   AS addr,  value::numeric  AS amt
               FROM token_transfers WHERE LOWER(contract_address) = $1
               UNION ALL
               SELECT from_address AS addr, -value::numeric  AS amt
               FROM token_transfers WHERE LOWER(contract_address) = $1
             )
             SELECT addr AS address, SUM(amt)::text AS balance
             FROM flows
             WHERE addr IS NOT NULL AND addr != $2
             GROUP BY addr
             HAVING SUM(amt) > 0
             ORDER BY SUM(amt) DESC
             LIMIT $3 OFFSET $4`,
            [addrLower, ZERO_ADDR, limit, offset]
          ),
          query<CountRow>(
            `WITH flows AS (
               SELECT to_address   AS addr,  value::numeric  AS amt
               FROM token_transfers WHERE LOWER(contract_address) = $1
               UNION ALL
               SELECT from_address AS addr, -value::numeric  AS amt
               FROM token_transfers WHERE LOWER(contract_address) = $1
             )
             SELECT COUNT(*) AS count FROM (
               SELECT addr FROM flows
               WHERE addr IS NOT NULL AND addr != $2
               GROUP BY addr HAVING SUM(amt) > 0
             ) h`,
            [addrLower, ZERO_ADDR]
          ),
        ]);

        let totalSupply = 0n;
        try { totalSupply = BigInt(totalSupplyStr || '0'); } catch { /* keep 0 */ }

        res.json({
          holders: rows.map((r) => {
            let pct = 0;
            try {
              if (totalSupply > 0n) {
                const bal = BigInt(r.balance);
                // percent with 4-decimal precision via scaled integer math
                pct = Number((bal * 1_000_000n) / totalSupply) / 10_000;
              }
            } catch { /* keep 0 */ }
            return { address: r.address, balance: r.balance, percentage: pct };
          }),
          total: parseInt(countResult[0]?.count ?? '0'),
          limit,
          offset,
        });
      }
    } catch (err) {
      logger.error({ err: err instanceof Error ? err.message : String(err) }, '[api] /tokens/:address/holders error');
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ── LITHO price (USD) ──────────────────────────────────────────────

  // Testnet: fixed price. Mainnet: switch to live API after TGE.
  const TESTNET_PRICE = 5; // $5 USD per LITHO (testnet only)
  const IS_MAINNET = process.env.NETWORK === 'mainnet';

  const marketPrice = () => loadCachedShared('litho-dex-price-v1', 60_000, fetchLithoMarketPrice);

  r.get('/market-summary', async (_req: Request, res: Response) => {
    try {
      const [market, totalSupply, stake, activity] = await Promise.all([
        IS_MAINNET ? marketPrice() : Promise.resolve(null),
        loadCachedShared(`native-supply:${RPC_URL}`, 60_000, fetchNativeSupply),
        loadCachedShared(`bonded-stake:${RPC_URL}`, 15_000, () => query<{ total: string }>(
          'SELECT COALESCE(SUM(tokens::numeric), 0)::text AS total FROM validators WHERE status = 3 AND jailed = FALSE'
        )).catch(() => null),
        loadCachedShared(`recent-tps:${RPC_URL}`, 15_000, () => query<{ tps: string }>(
          "SELECT (COALESCE(SUM(num_txs), 0)::numeric / 60)::text AS tps FROM blocks WHERE block_time > NOW() - INTERVAL '60 seconds'"
        )).catch(() => null),
      ]);
      res.json({ market, totalSupply, bondedTokens: stake?.[0]?.total ?? null, transactionsPerSecond: activity?.[0]?.tps ?? null });
    } catch {
      res.status(503).json({ message: 'Market summary unavailable' });
    }
  });

  r.get('/price', async (_req: Request, res: Response) => {
    try {
      // Testnet: return fixed price
      if (!IS_MAINNET) {
        res.json({ price: TESTNET_PRICE, symbol: 'LITHO', currency: 'USD' });
        return;
      }

      const market = await marketPrice();
      res.json({ ...market, price: market.price == null ? null : Number(market.price), symbol: 'LITHO' });
    } catch (err) {
      logger.error({ err: err instanceof Error ? err.message : String(err) }, '[api] /price error');
      res.json({ price: null, symbol: 'LITHO', currency: 'USD' });
    }
  });

  // ── Debug / Diagnostics ─────────────────────────────────────────────

  r.get('/debug', async (_req: Request, res: Response) => {
    try {
      const [
        syncSummary,
        indexerState,
        blockCount,
        txCount,
        evmTxCount,
        minBlock,
        maxBlock,
        maxTx,
        sampleBlock,
        tableColumns,
        inconsistentSample,
      ] = await Promise.all([
        getSyncSummary().catch(() => ({
          tipHeight: 0,
          chainTipHeight: 0,
          latestTransactionHeight: 0,
          latestBlockTimestamp: null,
          latestTransactionTimestamp: null,
          syncLagBlocks: 0,
          isSyncing: false,
          inconsistentBlocks: 0,
        })),
        query<{ key: string; value: string }>('SELECT * FROM indexer_state').catch(() => []),
        query<CountRow>('SELECT COUNT(*) AS count FROM blocks').catch(() => [{ count: '?' }]),
        query<CountRow>('SELECT COUNT(*) AS count FROM transactions').catch(() => [{ count: '?' }]),
        query<CountRow>('SELECT COUNT(*) AS count FROM evm_transactions').catch(() => [{ count: '?' }]),
        query<{ height: string }>('SELECT MIN(height) AS height FROM blocks').catch(() => []),
        query<{ height: string }>('SELECT MAX(height) AS height FROM blocks').catch(() => []),
        query<{ height: string }>('SELECT COALESCE(MAX(block_height), 0)::text AS height FROM transactions').catch(() => []),
        query<Record<string, unknown>>('SELECT * FROM blocks ORDER BY height ASC LIMIT 1').catch(() => []),
        query<{ column_name: string; data_type: string; character_maximum_length: number | null }>(
          `SELECT column_name, data_type, character_maximum_length
           FROM information_schema.columns WHERE table_name = 'blocks' ORDER BY ordinal_position`
        ).catch(() => []),
        query<{ height: string }>(`
          ${INCONSISTENT_BLOCKS_CTE}
          SELECT height::text AS height
          FROM inconsistent_blocks
          ORDER BY height DESC
          LIMIT 20
        `).catch(() => []),
      ]);

      res.json({
        sync: syncSummary,
        indexerState,
        counts: {
          blocks: blockCount[0]?.count,
          transactions: txCount[0]?.count,
          evmTransactions: evmTxCount[0]?.count,
        },
        blockRange: {
          min: minBlock[0]?.height,
          max: maxBlock[0]?.height,
        },
        transactionRange: {
          max: maxTx[0]?.height ?? '0',
        },
        inconsistentBlockSample: inconsistentSample.map((row) => row.height),
        sampleBlock: sampleBlock[0] ?? null,
        blocksSchema: tableColumns,
      });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // ── Faucet proxy (forwards to faucet service on :8081) ─────────────

  r.get('/faucet/info', async (_req: Request, res: Response) => {
    try {
      const faucetUrl = process.env.FAUCET_INTERNAL_URL || 'http://faucet:8081';
      const upstream = await fetch(`${faucetUrl}/health`, {
        signal: AbortSignal.timeout(10_000),
      });

      const data = await upstream.json() as Record<string, unknown>;

      if (!upstream.ok) {
        res.status(upstream.status).json({
          ok: false,
          message: sanitizeUpstreamMessage(
            (data.message as string) || (data.error as string),
            'Faucet info is unavailable.',
          ),
        });
        return;
      }

      res.json({
        ok: true,
        ...data,
      });
    } catch (err) {
      logger.error({ err: err instanceof Error ? err.message : String(err) }, '[api] /faucet/info error');
      res.status(502).json({
        ok: false,
        message: 'Faucet service is unavailable. Please try again later.',
      });
    }
  });

  r.post('/faucet/claim', async (req: Request, res: Response) => {
    try {
      const { address, amount, assetId, asset } = req.body ?? {};
      const normalizedAddress = typeof address === 'string' ? address.trim() : '';
      const normalizedAmount = normalizeFaucetAmountInput(amount);

      if (!normalizedAddress) {
        logger.warn('[api] Rejecting faucet claim: missing address');
        audit({ action: 'faucet_claim_rejected', reason: 'missing_address' }, 'missing address');
        res.status(400).json({ ok: false, message: 'Wallet address is required.' });
        return;
      }

      // Validate address format
      const isEvm = /^0x[a-fA-F0-9]{40}$/.test(normalizedAddress);
      const isCosmos = normalizedAddress.startsWith('litho1');
      if (!isEvm && !isCosmos) {
        logger.warn({ address: sanitizeForLog(normalizedAddress) }, '[api] Rejecting faucet claim: invalid address format');
        audit(
          { action: 'faucet_claim_rejected', reason: 'invalid_address_format', actor: sanitizeForLog(normalizedAddress) },
          'invalid address format',
        );
        res.status(400).json({ ok: false, message: 'Invalid wallet address. Use a 0x... address.' });
        return;
      }

      // The faucet service only accepts EVM (0x) addresses
      // If cosmos address provided, we can't forward to the EVM faucet
      if (!isEvm) {
        logger.warn({ address: sanitizeForLog(normalizedAddress) }, '[api] Rejecting faucet claim for non-EVM address');
        audit(
          { action: 'faucet_claim_rejected', reason: 'non_evm_address', actor: sanitizeForLog(normalizedAddress) },
          'non-EVM address',
        );
        res.status(400).json({ ok: false, message: 'The faucet currently supports EVM (0x) addresses only. Please use your 0x address.' });
        return;
      }

      if (normalizedAmount.invalid) {
        logger.warn({ amount: sanitizeForLog(amount) }, '[api] Rejecting faucet claim: invalid amount');
        audit(
          { action: 'faucet_claim_rejected', reason: 'invalid_amount', actor: normalizedAddress, amount: sanitizeForLog(amount) },
          'invalid amount',
        );
        res.status(400).json({
          ok: false,
          message: 'Invalid amount. Provide a numeric faucet amount such as 1 or 5.',
        });
        return;
      }

      const faucetUrl = process.env.FAUCET_INTERNAL_URL || 'http://faucet:8081';
      const upstream = await fetch(`${faucetUrl}/drip`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          address: normalizedAddress,
          amount: normalizedAmount.value,
          assetId: typeof assetId === 'string' ? assetId : asset,
        }),
        signal: AbortSignal.timeout(30_000),
      });

      const data = await upstream.json() as Record<string, unknown>;

      if (!upstream.ok) {
        const sanitizedMessage = sanitizeUpstreamMessage(
          (data.message as string) || (data.error as string),
          'Faucet request failed.',
        );
        logger.warn({ status: upstream.status, address: normalizedAddress, message: sanitizedMessage }, '[api] Faucet claim failed upstream');
        audit(
          { action: 'faucet_claim_upstream_failed', actor: normalizedAddress, status: upstream.status, message: sanitizedMessage },
          'upstream faucet refused',
        );
        res.status(upstream.status).json({
          ok: false,
          message: sanitizedMessage,
          cooldownSeconds: data.retryAfterSeconds ?? null,
        });
        return;
      }

      const txHash = isEvmTxHash(typeof data.txHash === 'string' ? data.txHash.trim() : undefined)
        ? (data.txHash as string).trim()
        : null;
      if (data.txHash && !txHash) {
        logger.warn({ address: normalizedAddress }, '[api] Faucet upstream returned malformed tx hash');
      }

      audit(
        {
          action: 'faucet_claim_success',
          actor: normalizedAddress,
          amount: normalizedAmount.value,
          assetId: typeof assetId === 'string' ? assetId : asset ?? null,
          txHash,
        },
        'faucet claim succeeded',
      );

      res.json({
        ok: true,
        txHash,
        message: `Sent ${data.amount ?? normalizedAmount.value ?? ''} to ${normalizedAddress}`,
        cooldownSeconds:
          typeof data.retryAfterSeconds === 'number'
            ? data.retryAfterSeconds
            : ((data.cooldownHours as number) ?? 24) * 3600,
        assetId: data.assetId ?? (typeof assetId === 'string' ? assetId : asset ?? null),
      });
    } catch (err) {
      logger.error({ err: err instanceof Error ? err.message : String(err) }, '[api] /faucet/claim error');
      res.status(502).json({
        ok: false,
        message: 'Faucet service is unavailable. Please try again later.',
      });
    }
  });

  // ── Quantt research integration ──────────────────────────────────────────
  // Credentials are held only by this API. The browser receives provider data,
  // never the upstream URL's credentials or authentication headers.
  const quanttConfig = loadQuanttConfig();

  r.get('/quantt/status', (_req: Request, res: Response) => {
    res.json({
      ok: true,
      configured: quanttConfig !== null,
      researchUrl: QUANTT_RESEARCH_URL,
      developerUrl: QUANTT_DEVELOPER_URL,
      apiOrigin: quanttConfig?.baseUrl.origin ?? null,
    });
  });

  r.get('/quantt/insights', async (req: Request, res: Response) => {
    const rawSymbol = typeof req.query.symbol === 'string' ? req.query.symbol.trim() : '';
    if (!/^[a-zA-Z0-9._-]{2,20}$/.test(rawSymbol)) {
      res.status(400).json({ ok: false, message: 'Provide a valid asset symbol.' });
      return;
    }
    if (!quanttConfig) {
      res.status(503).json({
        ok: false,
        message: 'Quantt insights are not configured. Add the approved Quantt API endpoint and credentials.',
      });
      return;
    }

    const symbol = rawSymbol.toUpperCase();
    try {
      const upstream = await fetch(buildQuanttInsightsUrl(quanttConfig, symbol), {
        headers: quanttAuthHeaders(quanttConfig),
        signal: AbortSignal.timeout(quanttConfig.timeoutMs),
      });
      const body = await upstream.text();
      let data: unknown = null;
      try { data = JSON.parse(body); } catch { /* handled below */ }

      if (!upstream.ok || data === null) {
        logger.warn({ status: upstream.status, symbol }, '[api] Quantt upstream request failed');
        res.status(upstream.ok ? 502 : upstream.status).json({
          ok: false,
          message: 'Quantt insights are temporarily unavailable.',
        });
        return;
      }

      res.setHeader('Cache-Control', 'private, max-age=60');
      res.json({ ok: true, provider: 'quantt', symbol, data });
    } catch (err) {
      logger.error({ err: err instanceof Error ? err.message : String(err), symbol }, '[api] Quantt proxy error');
      res.status(502).json({ ok: false, message: 'Quantt insights are temporarily unavailable.' });
    }
  });

  // ── MultX bridge proxy (forwards to bridge-api, serves static route config) ──
  //
  // The bridge backend (bridge.litho.ai) is shared across chains and is not
  // CORS-open to the explorer origin, so the browser talks to these same-origin
  // /api/bridge/* routes and we forward server-side — same pattern as the faucet.
  const BRIDGE_API_URL = (process.env.BRIDGE_API_URL || 'https://bridge.litho.ai').replace(/\/$/, '');

  // Route 1 (Makalu ↔ Kamet) token pairs. Makalu addresses from
  // makalu-bridge-latest.json; Kamet addresses from the bridge token registry.
  const BRIDGE_TOKENS = [
    { symbol: 'wLITHO', name: 'Wrapped Lithosphere', decimals: 18, makalu: '0x599a7E135f1790ae117b4EdDc0422D24Bc766161', kamet: '0xC0FC628e3aB128fe387e7ed5e729bD809C017888' },
    { symbol: 'LitBTC', name: 'Lithosphere LitBTC',  decimals: 18, makalu: '0xC4645CA5411D6E27556780AB4cdd0DF7e609df74', kamet: '0x3A8D5FdC6c8dA9f14C535424b6F7206eC1996016' },
    { symbol: 'LAX',    name: 'Lithosphere Algo',     decimals: 18, makalu: '0x1Cde2Ca6c2ab8622003ebe06e382bC07850d4B8d', kamet: '0xe8f504f9cE5391Fb5968b317f0b24b8A0306ACeb' },
    { symbol: 'JOT',    name: 'Jot Art',              decimals: 18, makalu: '0xEF2f35f6d0fb7DC9E87b8ca8252AE2E6ffb2a25e', kamet: '0x6AE14CEb3962664b13c5dEF29EB172De76bd0ac9' },
    { symbol: 'COLLE',  name: 'Colle AI',             decimals: 18, makalu: '0x10D4BB600c96e9243E2f50baFED8b2478F25af61', kamet: '0x0573f66cb4bC34618e7AB8a941F7883DD2515dCA' },
    { symbol: 'IMAGE',  name: 'Imagen Network',       decimals: 18, makalu: '0xAcD98E323968647936887aD4934e64B01060727e', kamet: '0x8Ba6E3A0759144245f2939eB54164e32bb78B8E0' },
    { symbol: 'AGII',   name: 'AGII',                 decimals: 18, makalu: '0x10052B8ccD2160b8F9880C6b4F5DD117fF253B1c', kamet: '0x17D506aF1d0Dc2f4f64f15748a5aC46FAd3f06D7' },
    { symbol: 'BLDR',   name: 'Built AI',             decimals: 18, makalu: '0x798eD6bFc5bfCFc60938d5098825b354427A0786', kamet: '0xF05f1F79273874E554F02ce06585E16132a3B62B' },
    { symbol: 'FGPT',   name: 'FurGPT',               decimals: 18, makalu: '0x151ef362eA96853702Cc5e7728107e3961fbD22e', kamet: '0x2F366c6350A6b211f6D6F847c3D56738C2E847ca' },
    { symbol: 'MUSA',   name: 'Mansa AI',             decimals: 18, makalu: '0xDB829befCF8E582379E2c034FA2589b8D2EA1c5D', kamet: '0x17A357262097B4e70acFfe8B71bC61e8bBcc3B42' },
  ];

  const BRIDGE_CONFIG = {
    apiUrl: BRIDGE_API_URL,
    signaturesRequired: 2,
    chains: {
      makalu: { chainId: 700777, name: 'Lithosphere Makalu', bridge: '0x5832D5E609c6690f74c7683606Eb20F89ff096a6' },
      kamet:  { chainId: 900523, name: 'Lithosphere Kamet',  bridge: '0x3a896BDF3a1088287FA84aB5a43bB30e2535F263' },
    },
    tokens: BRIDGE_TOKENS,
  };

  async function proxyBridgeGet(upstreamPath: string, res: Response): Promise<void> {
    try {
      const upstream = await fetch(`${BRIDGE_API_URL}${upstreamPath}`, {
        signal: AbortSignal.timeout(10_000),
      });
      const text = await upstream.text();
      let data: unknown = null;
      try { data = JSON.parse(text); } catch { /* non-JSON upstream */ }

      if (!upstream.ok || data === null) {
        res.status(upstream.ok ? 502 : upstream.status).json({
          ok: false,
          message: 'Bridge service is unavailable. Please try again later.',
        });
        return;
      }
      res.json(data);
    } catch (err) {
      logger.error({ err: err instanceof Error ? err.message : String(err) }, '[api] /bridge proxy error');
      res.status(502).json({ ok: false, message: 'Bridge service is unavailable. Please try again later.' });
    }
  }

  r.get('/bridge/config', (_req: Request, res: Response) => {
    res.json({ ok: true, ...BRIDGE_CONFIG });
  });

  r.get('/bridge/chains', (_req: Request, res: Response) => {
    void proxyBridgeGet('/chains', res);
  });

  r.get('/bridge/status/:txHash', (req: Request, res: Response) => {
    const h = String(req.params.txHash ?? '');
    if (!/^0x[0-9a-fA-F]{64}$/.test(h)) {
      res.status(400).json({ ok: false, message: 'Invalid bridge transaction hash.' });
      return;
    }
    void proxyBridgeGet(`/bridge/status/${h}`, res);
  });

  r.get('/bridge/signatures/:txHash', (req: Request, res: Response) => {
    const h = String(req.params.txHash ?? '');
    if (!/^0x[0-9a-fA-F]{64}$/.test(h)) {
      res.status(400).json({ ok: false, message: 'Invalid bridge transaction hash.' });
      return;
    }
    void proxyBridgeGet(`/bridge/signatures/${h}`, res);
  });

  r.get('/bridge/transactions/:address', (req: Request, res: Response) => {
    const a = String(req.params.address ?? '');
    if (!/^0x[0-9a-fA-F]{40}$/.test(a)) {
      res.status(400).json({ ok: false, message: 'Invalid wallet address.' });
      return;
    }
    void proxyBridgeGet(`/bridge/transactions/${a}`, res);
  });

  // ── Sign in with Thanos (SIWE auth) ─────────────────────────────────────────
  // Backend half of the `thanos-connect` flow: issue a one-time nonce, then
  // verify the signed SIWE message and mint a session token. The SDK calls these
  // exact default paths (GET /auth/nonce?address=…, POST /auth/verify).
  const AUTH_SESSION_TTL_SEC = 24 * 60 * 60; // 24h session
  const AUTH_NONCE_TTL_MS = 10 * 60 * 1000; // 10 min nonce
  const configuredAuthChain = Number(process.env.AUTH_ALLOWED_CHAIN_ID || process.env.LITHO_CHAIN_ID || '700777');
  if (!Number.isSafeInteger(configuredAuthChain) || configuredAuthChain <= 0) {
    throw new Error('AUTH_ALLOWED_CHAIN_ID/LITHO_CHAIN_ID must be a positive integer');
  }
  const AUTH_ALLOWED_CHAIN = configuredAuthChain;

  // A stable secret keeps sessions valid across restarts; without one we fall
  // back to an ephemeral per-process secret (sessions reset on restart).
  const configuredSessionSecret = process.env.AUTH_SESSION_SECRET?.trim();
  if (process.env.NODE_ENV === 'production'
    && (!configuredSessionSecret || configuredSessionSecret.length < 32 || configuredSessionSecret.startsWith('<'))) {
    throw new Error('AUTH_SESSION_SECRET must be injected with at least 32 characters in production');
  }
  const sessionSecret = configuredSessionSecret || randomBytes(32).toString('hex');
  if (!configuredSessionSecret) {
    logger.warn('[api] AUTH_SESSION_SECRET not set — using an ephemeral secret; Thanos sessions reset on restart');
  }

  // One-time nonce store: nonce → { address(lowercased), expiresAt }.
  const authNonces = new Map<string, { address: string; expiresAt: number }>();
  const pruneNonces = () => {
    const now = Date.now();
    for (const [n, v] of authNonces) if (v.expiresAt <= now) authNonces.delete(n);
  };

  const b64url = (buf: Buffer): string =>
    buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  const signSession = (address: string): { token: string; expiresAt: number } => {
    const now = Math.floor(Date.now() / 1000);
    const exp = now + AUTH_SESSION_TTL_SEC;
    const payload = b64url(Buffer.from(JSON.stringify({ sub: address, chainId: AUTH_ALLOWED_CHAIN, iat: now, exp })));
    const sig = b64url(createHmac('sha256', sessionSecret).update(payload).digest());
    return { token: `${payload}.${sig}`, expiresAt: exp };
  };

  // GET /auth/nonce?address=0x… → text/plain nonce (per the thanos-connect contract).
  r.get('/auth/nonce', (req: Request, res: Response) => {
    const address = String(req.query.address ?? '').trim();
    if (!isAddress(address)) {
      res.status(400).type('text/plain').send('invalid address');
      return;
    }
    pruneNonces();
    const nonce = randomBytes(16).toString('hex'); // 32 hex chars — EIP-4361-valid
    authNonces.set(nonce, { address: address.toLowerCase(), expiresAt: Date.now() + AUTH_NONCE_TTL_MS });
    res.type('text/plain').send(nonce);
  });

  // POST /auth/verify { message, signature, address } → { ok, sessionToken, address, expiresAt }.
  r.post('/auth/verify', (req: Request, res: Response) => {
    try {
      const { message, signature, address } = req.body ?? {};
      if (typeof message !== 'string' || typeof signature !== 'string' || typeof address !== 'string') {
        res.status(400).json({ ok: false, error: 'message, signature, and address are required' });
        return;
      }
      if (!isAddress(address)) {
        res.status(400).json({ ok: false, error: 'invalid address' });
        return;
      }

      // 1. Recover the EIP-191 personal_sign signer and confirm it matches.
      let recovered: string;
      try {
        recovered = verifyMessage(message, signature);
      } catch {
        res.status(401).json({ ok: false, error: 'bad signature' });
        return;
      }
      if (getAddress(recovered) !== getAddress(address)) {
        res.status(401).json({ ok: false, error: 'signature does not match address' });
        return;
      }

      // 2. Pull the nonce + chain from the SIWE message body (EIP-4361 labels).
      const nonce = /\nNonce: ([^\n]+)/.exec(message)?.[1]?.trim();
      const chainId = Number(/\nChain ID: (\d+)/.exec(message)?.[1]);
      if (!nonce) {
        res.status(400).json({ ok: false, error: 'no nonce in message' });
        return;
      }
      if (chainId && chainId !== AUTH_ALLOWED_CHAIN) {
        res.status(400).json({ ok: false, error: `unexpected chain id ${chainId}` });
        return;
      }

      // 3. One-time nonce: must exist, be bound to this address, and be unexpired. Consume it.
      pruneNonces();
      const rec = authNonces.get(nonce);
      if (!rec || rec.expiresAt <= Date.now() || rec.address !== getAddress(address).toLowerCase()) {
        res.status(401).json({ ok: false, error: 'invalid or expired nonce' });
        return;
      }
      authNonces.delete(nonce);

      // 4. Mint the session token.
      const { token, expiresAt } = signSession(getAddress(address));
      audit({ action: 'thanos_signin', actor: getAddress(address) }, 'thanos sign-in');
      res.json({ ok: true, sessionToken: token, address: getAddress(address), expiresAt });
    } catch (err) {
      logger.error({ err: err instanceof Error ? err.message : String(err) }, '[api] /auth/verify error');
      res.status(500).json({ ok: false, error: 'verification failed' });
    }
  });

  // Validate a `payload.sig` session token: constant-time HMAC check + expiry.
  // Returns the decoded claims, or null if the token is forged/tampered/expired.
  interface SessionClaims { sub: string; chainId: number; iat: number; exp: number }
  const verifySession = (token: string): SessionClaims | null => {
    const dot = token.indexOf('.');
    if (dot <= 0) return null;
    const payload = token.slice(0, dot);
    const sig = token.slice(dot + 1);
    const expected = b64url(createHmac('sha256', sessionSecret).update(payload).digest());
    const sigBuf = Buffer.from(sig);
    const expBuf = Buffer.from(expected);
    if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) return null;
    try {
      const claims = JSON.parse(Buffer.from(payload, 'base64url').toString()) as SessionClaims;
      if (typeof claims.exp !== 'number' || claims.exp * 1000 <= Date.now()) return null;
      return claims;
    } catch {
      return null;
    }
  };

  const bearerToken = (req: Request): string | null => {
    const h = req.headers.authorization;
    return typeof h === 'string' && /^Bearer\s+/i.test(h) ? h.replace(/^Bearer\s+/i, '').trim() : null;
  };

  // GET /auth/me → validate the Authorization: Bearer session and return the
  // verified identity. This is the server-side half that makes the Thanos
  // session real: the token is HMAC-checked here, not merely trusted from the
  // client's localStorage. Front-ends call this on load to confirm a stored
  // session is still valid (and to gate authenticated views).
  r.get('/auth/me', (req: Request, res: Response) => {
    const token = bearerToken(req);
    if (!token) {
      res.status(401).json({ ok: false, error: 'missing bearer token' });
      return;
    }
    const claims = verifySession(token);
    if (!claims) {
      res.status(401).json({ ok: false, error: 'invalid or expired session' });
      return;
    }
    res.json({ ok: true, address: claims.sub, chainId: claims.chainId, expiresAt: claims.exp });
  });

  return r;
}
