/**
 * REST API routes consumed by the Explorer frontend.
 *
 * The explorer calls /api/* paths (e.g. /api/blocks, /api/stats/summary).
 * Routes query the same PostgreSQL database that the indexer writes to.
 */
import { Router, type Request, type Response } from 'express';
import { bech32 } from 'bech32';
import { query } from './db.js';
import {
  isEvmTxHash,
  normalizeEvmTxHash,
  pickValidTxHash,
  sanitizeUpstreamMessage,
} from './tx-utils.js';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const HIDDEN_TOKEN_SYMBOLS = new Set(['LitBTC']);
const HIDDEN_TOKEN_ADDRESSES = new Set(['0x468022f17cafebd43c18f68d53c66a1a7f0e5249']);
const RPC_URL = (process.env.RPC_URL || process.env.LITHO_RPC_URL || 'https://rpc.litho.ai').replace(/\/$/, '');
const SYNCING_LAG_THRESHOLD = 1000;
const EVM_RPC_URL = (process.env.EVM_RPC_URL || '').replace(/\/$/, '');
const EVM_RPC_ENDPOINTS = [...new Set([EVM_RPC_URL, RPC_URL].filter(Boolean))];

function isHiddenToken(token: { symbol?: string | null; address?: string | null }): boolean {
  const symbol = token.symbol?.trim();
  const address = token.address?.toLowerCase();
  return (symbol ? HIDDEN_TOKEN_SYMBOLS.has(symbol) : false)
    || (address ? HIDDEN_TOKEN_ADDRESSES.has(address) : false);
}

/**
 * Convert EVM wei to ulitho.
 * Lithosphere uses 18 decimals (Ethermint): 1 LITHO = 1e18 ulitho.
 * 1 wei = 1 ulitho, so no conversion needed.
 */
function weiToUlitho(wei: string | null | undefined): string {
  if (!wei || wei === '0') return '0';
  try {
    return String(BigInt(wei));
  } catch {
    return '0';
  }
}

function clamp(val: unknown, def = DEFAULT_LIMIT): number {
  const n = Number(val);
  if (!n || n < 1) return def;
  return Math.min(n, MAX_LIMIT);
}

function clampOffset(val: unknown): number {
  const n = Number(val);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

function normalizeFaucetAmountInput(value: unknown): { value?: string; invalid: boolean } {
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
function evmToCosmos(evmAddr: string | null | undefined): string | undefined {
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
function cosmosToEvm(cosmosAddr: string | null | undefined): string | undefined {
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

interface AddressForms {
  query: string;
  queryLower: string;
  cosmosAddress?: string;
  evmAddress?: string;
  searchAddrs: string[];
  contractSearchAddrs: string[];
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
  moniker: string | null;
  tokens: string;
  commission_rate: string | null;
  status: number;
  jailed: boolean;
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

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Strip Ethereum branding from Cosmos SDK method names */
function cleanMethod(m: string | null | undefined): string | undefined {
  if (!m) return undefined;
  return m.replace(/MsgEthereumTx/g, 'MsgTx');
}

/** Classify EVM transaction type based on inputData and toAddr */
function classifyTxType(inputData?: string | null, toAddr?: string | null, contractAddr?: string | null): 'transfer' | 'call' | 'create' {
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
function decodeMethodName(inputData?: string | null): string | undefined {
  if (!inputData || inputData === '0x' || inputData.length < 10) return undefined;
  const selector = inputData.slice(0, 10).toLowerCase();
  return METHOD_SIGS[selector] ?? selector;
}

/** Decode ERC-20 Transfer amount from input data (selector 0xa9059cbb)
 *  function transfer(address to, uint256 amount)
 *  Params: 2nd param (amount) is at offset 64-128 (bytes 32-64 in hex string)
 */
function decodeTransferAmount(inputData?: string | null): string | null {
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
function computeFeeUlitho(gasUsed: string | number | null | undefined, gasPriceWei: string | null | undefined): string | null {
  if (!gasUsed || !gasPriceWei || gasPriceWei === '0') return null;
  try {
    const fee = BigInt(gasUsed) * BigInt(gasPriceWei);
    return String(fee);
  } catch {
    return null;
  }
}

/** Parse hex string to decimal string using BigInt (safe for large values) */
function hexToDec(hex: string | null | undefined): string {
  if (!hex || hex === '0x0' || hex === '0x') return '0';
  try { return String(BigInt(hex)); } catch { return '0'; }
}

function parseIntSafe(value: string | number | null | undefined): number {
  const parsed = typeof value === 'number' ? value : parseInt(value ?? '0', 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseHexInteger(value: string | null | undefined): number | null {
  if (!value) return null;
  try {
    const parsed = Number(BigInt(value));
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function toIsoString(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function hexTimestampToIso(value: string | null | undefined): string | undefined {
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
    console.warn('[api] chain tip fetch failed:', err instanceof Error ? err.message : String(err));
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
    query<CountRow>(`
      ${INCONSISTENT_BLOCKS_CTE}
      SELECT COUNT(*) AS count FROM inconsistent_blocks
    `).catch(() => [{ count: '0' }]),
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
        console.error(`[evmRpcCall] ${method} HTTP ${resp.status} from ${endpoint}`);
        continue;
      }
      const data = await resp.json() as { result?: unknown; error?: unknown };
      if (data.error) {
        console.error(`[evmRpcCall] ${method} RPC error from ${endpoint}:`, data.error);
        continue;
      }
      if (data.result != null) return data.result;
    } catch (err) {
      console.error(`[evmRpcCall] ${method} fetch exception from ${endpoint}:`, err);
    }
  }

  return null;
}

/** Fetch live EVM balance if address is an EVM address and RPC is available */
async function fetchLiveBalance(addr: string): Promise<string> {
  if (!addr.startsWith('0x') || EVM_RPC_ENDPOINTS.length === 0) return '0';
  try {
    const result = await evmRpcCall('eth_getBalance', [addr, 'latest']);
    if (typeof result === 'string') return hexToDec(result);
  } catch {}
  return '0';
}

type EvmExtra = { value?: string | null; gas_price?: string | null; from_address?: string | null; to_address?: string | null; input_data?: string | null; contract_address?: string | null; nonce?: number | null };

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
  const valueIsBad = !evmExtra.value || evmExtra.value === '0' || Number(evmExtra.value) === 0;
  const gasPriceIsBad = !evmExtra.gas_price || evmExtra.gas_price === '0' || Number(evmExtra.gas_price) === 0;
  if (!valueIsBad && !gasPriceIsBad) return evmExtra;

  if (!isEvmTxHash(evmHash)) {
    console.warn(`[api] Skipping EVM enrichment for malformed hash: ${String(evmHash).slice(0, 80)}`);
    return evmExtra;
  }

  const rpcTx = await evmRpcCall('eth_getTransactionByHash', [evmHash]) as { value?: string; gasPrice?: string; from?: string; to?: string; input?: string; nonce?: string } | null;
  if (!rpcTx) return evmExtra;

  const enriched = { ...evmExtra };
  if (valueIsBad && rpcTx.value) enriched.value = hexToDec(rpcTx.value);
  if (gasPriceIsBad && rpcTx.gasPrice) enriched.gas_price = hexToDec(rpcTx.gasPrice);
  if (!enriched.from_address && rpcTx.from) enriched.from_address = rpcTx.from.toLowerCase();
  if (!enriched.to_address && rpcTx.to) enriched.to_address = rpcTx.to.toLowerCase();
  if (!enriched.input_data && rpcTx.input) enriched.input_data = rpcTx.input;
  if (enriched.nonce == null && rpcTx.nonce) enriched.nonce = Number(BigInt(rpcTx.nonce));

  return enriched;
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

function mapBlockDetail(r: BlockRow, txs: Array<TxRow & { evm_hash?: string | null; evm_input_data?: string | null; evm_contract_address?: string | null; evm_from_address?: string | null; evm_to_address?: string | null; evm_value?: string | null; evm_gas_price?: string | null; evm_nonce?: number | null }>) {
  return {
    ...mapBlock(r),
    parentHash: null,
    proposerAddress: r.proposer_address ?? null,
    gasUsed: r.total_gas ?? '0',
    txs: txs.map((t) => mapTx(t, t.evm_hash, { input_data: t.evm_input_data, contract_address: t.evm_contract_address, from_address: t.evm_from_address, to_address: t.evm_to_address, value: t.evm_value, gas_price: t.evm_gas_price, nonce: t.evm_nonce })),
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
  forms?: Pick<AddressForms, 'queryLower' | 'evmAddress' | 'cosmosAddress'>
) {
  // If user queried by EVM address, show that as primary
  const isEvmQuery = forms?.queryLower?.startsWith('0x');
  const evmAddr = forms?.evmAddress ?? r.evm_address ?? (r.address.startsWith('0x') ? r.address : undefined);
  const cosmosAddr = forms?.cosmosAddress ?? (r.address.startsWith('litho') ? r.address : undefined);
  return {
    address: isEvmQuery && evmAddr ? evmAddr : (cosmosAddr ?? r.address),
    evmAddress: evmAddr ?? undefined,
    cosmosAddress: cosmosAddr ?? undefined,
    balance: r.balance ?? '0',
    txCount: Number(r.tx_count ?? 0),
    lastSeen: r.updated_at instanceof Date ? r.updated_at.toISOString() : String(r.updated_at),
  };
}

const STATUS_LABELS: Record<number, string> = { 1: 'Unbonded', 2: 'Unbonding', 3: 'Bonded' };

function mapValidator(r: ValidatorRow) {
  // votingPower is in ulitho (18 decimals) — convert to whole LITHO with commas
  let votingPower = '0';
  try {
    const tokens = BigInt(r.tokens ?? '0');
    const litho = tokens / BigInt('1000000000000000000');
    votingPower = litho.toLocaleString('en-US');
  } catch { /* keep 0 */ }

  // commission_rate is a Cosmos decimal string like "0.100000000000000000" → "10%"
  let commission = '0%';
  try {
    const rate = parseFloat(r.commission_rate ?? '0');
    commission = (rate * 100).toFixed(2).replace(/\.?0+$/, '') + '%';
  } catch { /* keep 0% */ }

  return {
    address: r.operator_address,
    moniker: r.moniker ?? r.operator_address.slice(0, 16) + '...',
    votingPower,
    commission,
    status: STATUS_LABELS[r.status] ?? 'Unknown',
  };
}

// ── Router ──────────────────────────────────────────────────────────────────

export function explorerRouter(): Router {
  const r = Router();

  // ── Stats summary (homepage) ────────────────────────────────────────────

  r.get('/stats/summary', async (_req: Request, res: Response) => {
    try {
      const [syncSummary, tx1m, tx5m, totalTxs, walletCount, avgBlockTime] = await Promise.all([
        getSyncSummary(),
        query<CountRow>(
          `SELECT COUNT(*) AS count FROM transactions
           WHERE timestamp > NOW() - INTERVAL '1 minute'`
        ),
        query<CountRow>(
          `SELECT COUNT(*) AS count FROM transactions
           WHERE timestamp > NOW() - INTERVAL '5 minutes'`
        ),
        query<CountRow>('SELECT COUNT(*) AS count FROM transactions'),
        query<CountRow>(
          `SELECT COUNT(*) AS count FROM (
             SELECT address FROM accounts
             UNION
             SELECT DISTINCT from_address FROM evm_transactions WHERE from_address IS NOT NULL
             UNION
             SELECT DISTINCT to_address FROM evm_transactions WHERE to_address IS NOT NULL
           ) all_addrs`
        ),
        query<{ avg_seconds: string }>(
          `SELECT COALESCE(EXTRACT(EPOCH FROM AVG(diff)), 0) AS avg_seconds FROM (
             SELECT block_time - LAG(block_time) OVER (ORDER BY height) AS diff
             FROM blocks ORDER BY height DESC LIMIT 100
           ) sub WHERE diff IS NOT NULL`
        ).catch(() => [{ avg_seconds: '0' }]),
      ]);
      const txs1m = parseInt(tx1m[0]?.count ?? '0');
      const txs5m = parseInt(tx5m[0]?.count ?? '0');
      res.json({
        ...syncSummary,
        tps1m: Math.round((txs1m / 60) * 100) / 100,
        tps5m: Math.round((txs5m / 300) * 100) / 100,
        totalTransactions: parseInt(totalTxs[0]?.count ?? '0'),
        walletAddresses: parseInt(walletCount[0]?.count ?? '0'),
        avgBlockTime: Math.round(parseFloat(avgBlockTime[0]?.avg_seconds ?? '0') * 10) / 10,
      });
    } catch (err) {
      console.error('[api] /stats/summary error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ── Config (token info) ─────────────────────────────────────────────────

  r.get('/config', (_req: Request, res: Response) => {
    res.json({
      token: { symbol: 'LITHO', decimals: 18 },
      fiat: { symbol: 'USD', price: null, fetchedAt: null },
    });
  });

  // ── Blocks ──────────────────────────────────────────────────────────────

  r.get('/blocks', async (req: Request, res: Response) => {
    try {
      const limit = clamp(req.query.limit);
      const offset = Math.max(0, Number(req.query.offset) || 0);
      const rows = await query<BlockRow>(
        'SELECT * FROM blocks ORDER BY height DESC LIMIT $1 OFFSET $2',
        [limit, offset]
      );
      res.json(rows.map(mapBlock));
    } catch (err) {
      console.error('[api] /blocks error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  r.get('/blocks/:height', async (req: Request, res: Response) => {
    try {
      const { height } = req.params;
      const blocks = await query<BlockRow>(
        'SELECT * FROM blocks WHERE height = $1',
        [height]
      );
      if (!blocks[0]) {
        res.status(404).json({ message: 'Block not found' });
        return;
      }
      const txs = await query<TxRow & { evm_hash: string | null; evm_input_data: string | null; evm_contract_address: string | null; evm_from_address: string | null; evm_to_address: string | null; evm_value: string | null; evm_gas_price: string | null; evm_nonce: number | null }>(
        `SELECT t.*, e.hash AS evm_hash, e.input_data AS evm_input_data, e.contract_address AS evm_contract_address, e.from_address AS evm_from_address, e.to_address AS evm_to_address, e.value AS evm_value, e.gas_price AS evm_gas_price, e.nonce AS evm_nonce
         FROM transactions t
         LEFT JOIN evm_transactions e ON e.cosmos_tx_hash = t.hash
         WHERE t.block_height = $1
         ORDER BY t.tx_index ASC`,
        [height]
      );
      const enrichedTxs = await enrichEvmRows(txs);
      res.json(mapBlockDetail(blocks[0], enrichedTxs));
    } catch (err) {
      console.error('[api] /blocks/:height error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ── Transactions ────────────────────────────────────────────────────────

  r.get('/txs', async (req: Request, res: Response) => {
    try {
      const limit = clamp(req.query.limit);
      const offset = Math.max(0, Number(req.query.offset) || 0);
      const rows = await query<TxRow & { evm_hash: string | null; evm_input_data: string | null; evm_contract_address: string | null; evm_from_address: string | null; evm_to_address: string | null; evm_value: string | null; evm_gas_price: string | null; evm_nonce: number | null }>(
        `SELECT t.*, e.hash AS evm_hash, e.input_data AS evm_input_data, e.contract_address AS evm_contract_address, e.from_address AS evm_from_address, e.to_address AS evm_to_address, e.value AS evm_value, e.gas_price AS evm_gas_price, e.nonce AS evm_nonce
         FROM transactions t
         LEFT JOIN evm_transactions e ON e.cosmos_tx_hash = t.hash
         ORDER BY t.timestamp DESC, t.block_height DESC
         LIMIT $1 OFFSET $2`,
        [limit, offset]
      );

      const countResult = await query<CountRow>('SELECT COUNT(*) AS count FROM transactions');

      const enrichedRows = await Promise.all(rows.map(async (r) => {
        let evmExtra: EvmExtra = {
          input_data: r.evm_input_data, contract_address: r.evm_contract_address,
          from_address: r.evm_from_address, to_address: r.evm_to_address,
          value: r.evm_value, gas_price: r.evm_gas_price, nonce: r.evm_nonce
        };
        if (r.evm_hash) evmExtra = await enrichEvmFromRpc(r.evm_hash, evmExtra);
        return mapTx(r, r.evm_hash, evmExtra);
      }));

      res.json({
        txs: enrichedRows,
        total: parseInt(countResult[0]?.count ?? '0'),
        limit,
        offset,
      });
    } catch (err) {
      console.error('[api] /txs error:', err);
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
        res.json({ ...mapTx(rows[0], rows[0].evm_hash, evmExtra), ...(fee ? { feePaid: fee } : {}) });
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
        res.json({ ...mapTx(rows2[0], rows2[0].evm_hash, evmExtra), ...(fee ? { feePaid: fee } : {}) });
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
        res.json(fee ? { ...mapped, feePaid: fee } : mapped);
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
      console.error('[api] /txs/:hash error:', err);
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
        console.warn(`[api] Skipping receipt lookup for malformed hash: ${String(evmHash).slice(0, 80)}`);
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
      console.error('[api] /txs/:hash/logs error:', err);
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

        const result: Record<string, unknown> = mapAddress(rows[0], forms);

        // Fetch live balance from RPC (more accurate than DB)
        if (forms.evmAddress) {
          const liveBalance = await fetchLiveBalance(forms.evmAddress);
          if (liveBalance !== '0') result.balance = liveBalance;
        }
        if (tokenInfo[0]) {
          if (isHiddenToken({ symbol: tokenInfo[0].symbol, address: forms.evmAddress ?? forms.queryLower })) {
            res.status(404).json({ message: 'Address not found' });
            return;
          }
          result.isContract = true;
          result.isToken = !!(tokenInfo[0].symbol || tokenInfo[0].contract_type === 'token');
          result.tokenName = tokenInfo[0].name;
          result.tokenSymbol = tokenInfo[0].symbol;
          result.tokenDecimals = tokenInfo[0].decimals;
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
        res.json({
          address: forms.queryLower.startsWith('0x') ? (forms.evmAddress ?? c.address) : (forms.cosmosAddress ?? c.address),
          evmAddress: forms.evmAddress ?? c.address,
          cosmosAddress: forms.cosmosAddress,
          balance: '0',
          txCount: 0,
          lastSeen: new Date().toISOString(),
          isContract: true,
          isToken: !!(c.symbol || c.contract_type === 'token'),
          tokenName: c.name,
          tokenSymbol: c.symbol,
          tokenDecimals: c.decimals,
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
        const [lastTx, liveBalance] = await Promise.all([
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
          fetchLiveBalance(forms.evmAddress ?? forms.queryLower),
        ]);
        res.json({
          address: forms.queryLower.startsWith('0x')
            ? (forms.evmAddress ?? forms.queryLower)
            : (forms.cosmosAddress ?? forms.queryLower),
          evmAddress: forms.evmAddress,
          cosmosAddress: forms.cosmosAddress,
          balance: liveBalance,
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
          txCount: 0,
          blocksProposed,
          isValidator: true,
          lastSeen: proposerBlocks[0]?.last_time instanceof Date
            ? proposerBlocks[0].last_time.toISOString()
            : new Date().toISOString(),
        });
        return;
      }

      res.status(404).json({ message: 'Account not found' });
    } catch (err) {
      console.error('[api] /address/:address error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  r.get('/address/:address/txs', async (req: Request, res: Response) => {
    try {
      const { address } = req.params;
      const limit = clamp(req.query.limit, 25);
      const offset = clampOffset(req.query.offset);
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
      const items = enrichedRows.map((r) => mapTx(r, r.evm_hash, {
        input_data: r.evm_input_data,
        contract_address: r.evm_contract_address,
        from_address: r.evm_from_address,
        to_address: r.evm_to_address,
        value: r.evm_value,
        gas_price: r.evm_gas_price,
        nonce: r.evm_nonce,
      }));
      const total = parseInt(countRows[0]?.count ?? '0', 10);

      res.json({
        items,
        total,
        limit,
        offset,
        hasMore: offset + items.length < total,
      });
    } catch (err) {
      console.error('[api] /address/:address/txs error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ── Validators ──────────────────────────────────────────────────────────

  r.get('/validators', async (_req: Request, res: Response) => {
    try {
      const rows = await query<ValidatorRow>(
        'SELECT * FROM validators ORDER BY tokens DESC LIMIT 100'
      );
      res.json(rows.map(mapValidator));
    } catch (err) {
      console.error('[api] /validators error:', err);
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
        creator: string | null;
        created_at: Date;
      }>(
        `SELECT address, name, symbol, decimals, total_supply, creator, created_at
         FROM contracts WHERE contract_type = 'token' OR symbol IS NOT NULL ORDER BY created_at DESC LIMIT 100`
      ).catch(() => []);

      // Get holder count for native LITHO (accounts + unique EVM addresses)
      const [holderCount, totalTxCount] = await Promise.all([
        query<CountRow>(
          `SELECT COUNT(*) AS count FROM (
             SELECT address FROM accounts WHERE balance != '0'
             UNION
             SELECT DISTINCT from_address FROM evm_transactions WHERE from_address IS NOT NULL
             UNION
             SELECT DISTINCT to_address FROM evm_transactions WHERE to_address IS NOT NULL
           ) all_holders`
        ).catch(() => [{ count: '0' }]),
        query<CountRow>('SELECT COUNT(*) AS count FROM transactions').catch(() => [{ count: '0' }]),
      ]);

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
        ...visibleContractTokens.map((c) => ({
          symbol: c.symbol ?? 'Unknown',
          name: c.name ?? 'Unknown Token',
          decimals: c.decimals ?? 18,
          totalSupply: c.total_supply,
          type: 'LEP100' as const,
          holders: null,
          contractAddress: c.address,
        })),
      ];

      res.json(tokens);
    } catch (err) {
      console.error('[api] /tokens error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ── Token detail by contract address (or "native" for LITHO) ────────

  r.get('/tokens/:address', async (req: Request, res: Response) => {
    try {
      const { address } = req.params;

      // Native LITHO token
      if (address === 'native') {
        const [holderCount, totalTxCount] = await Promise.all([
          query<CountRow>(
            `SELECT COUNT(*) AS count FROM (
               SELECT address FROM accounts WHERE balance != '0'
               UNION
               SELECT DISTINCT from_address FROM evm_transactions WHERE from_address IS NOT NULL
               UNION
               SELECT DISTINCT to_address FROM evm_transactions WHERE to_address IS NOT NULL
             ) all_holders`
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
      const [holderCount, transferCount] = await Promise.all([
        query<CountRow>(
          `SELECT COUNT(*) AS count FROM (
             SELECT DISTINCT from_address AS addr FROM evm_transactions WHERE LOWER(to_address) = $1
             UNION
             SELECT DISTINCT to_address AS addr FROM evm_transactions WHERE LOWER(from_address) = $1
             UNION
             SELECT DISTINCT sender AS addr FROM transactions WHERE LOWER(receiver) = $1
             UNION
             SELECT DISTINCT receiver AS addr FROM transactions WHERE LOWER(sender) = $1
           ) holders`,
          [addrLower]
        ).catch(() => [{ count: '0' }]),
        query<CountRow>(
          `SELECT COUNT(*) AS count FROM (
             SELECT hash FROM transactions WHERE LOWER(sender) = $1 OR LOWER(receiver) = $1
             UNION
             SELECT hash FROM evm_transactions WHERE LOWER(from_address) = $1 OR LOWER(to_address) = $1
           ) all_txs`,
          [addrLower]
        ).catch(() => [{ count: '0' }]),
      ]);

      res.json({
        address: c.address,
        name: c.name ?? 'Unknown Token',
        symbol: c.symbol ?? 'Unknown',
        decimals: c.decimals ?? 18,
        totalSupply: c.total_supply,
        type: 'LEP100',
        creator: c.creator,
        creationTx: pickValidTxHash(c.creation_tx) ?? null,
        creationBlock: c.creation_block ? parseInt(c.creation_block) : null,
        createdAt: c.created_at instanceof Date ? c.created_at.toISOString() : String(c.created_at),
        holders: parseInt(holderCount[0]?.count ?? '0'),
        transfers: parseInt(transferCount[0]?.count ?? '0'),
        contractAddress: c.address,
        standard: 'LEP-100',
        description: null,
        verified: c.verified ?? false,
      });
    } catch (err) {
      console.error('[api] /tokens/:address error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ── Token roles (AccessControl RoleGranted events) ────────────────

  r.get('/tokens/:address/roles', async (req: Request, res: Response) => {
    try {
      const { address } = req.params;
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
      console.error('[api] /tokens/:address/roles error:', err);
      res.json({ roles: [] });
    }
  });

  // ── Token transfers list ──────────────────────────────────────────

  r.get('/tokens/:address/transfers', async (req: Request, res: Response) => {
    try {
      const { address } = req.params;
      const limit = clamp(req.query.limit, 25);
      const offset = Number(req.query.offset) || 0;

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
        // LEP100: transactions involving this contract
        const addrLower = address.toLowerCase();
        const [rows, countResult] = await Promise.all([
          query<{ hash: string; from_address: string; to_address: string | null; value: string | null; block_height: string; timestamp: Date }>(
            `SELECT e.hash, e.from_address, e.to_address, e.value, e.block_height, e.timestamp
             FROM evm_transactions e
             WHERE LOWER(e.from_address) = $1 OR LOWER(e.to_address) = $1 OR LOWER(e.contract_address) = $1
             ORDER BY e.block_height DESC LIMIT $2 OFFSET $3`,
            [addrLower, limit, offset]
          ),
          query<CountRow>(
            `SELECT COUNT(*) AS count FROM evm_transactions
             WHERE LOWER(from_address) = $1 OR LOWER(to_address) = $1 OR LOWER(contract_address) = $1`,
            [addrLower]
          ),
        ]);
        res.json({
          transfers: rows.map((r) => ({
            txHash: pickValidTxHash(r.hash) ?? '',
            fromAddress: r.from_address,
            toAddress: r.to_address ?? '',
            value: weiToUlitho(r.value),
            blockHeight: Number(r.block_height),
            timestamp: r.timestamp instanceof Date ? r.timestamp.toISOString() : String(r.timestamp),
          })),
          total: parseInt(countResult[0]?.count ?? '0'),
          limit,
          offset,
        });
      }
    } catch (err) {
      console.error('[api] /tokens/:address/transfers error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ── Token holders list ────────────────────────────────────────────

  r.get('/tokens/:address/holders', async (req: Request, res: Response) => {
    try {
      const { address } = req.params;
      const limit = clamp(req.query.limit, 25);
      const offset = Number(req.query.offset) || 0;

      if (address === 'native') {
        // Native LITHO: dynamically fetch for active EVM addresses (since indexer accounts lacks balances)
        const [rows, countResult] = await Promise.all([
          query<{ address: string }>(
            `SELECT addr AS address FROM (
               SELECT DISTINCT from_address AS addr FROM evm_transactions WHERE from_address IS NOT NULL
               UNION
               SELECT DISTINCT to_address AS addr FROM evm_transactions WHERE to_address IS NOT NULL
             ) all_holders
             LIMIT $1 OFFSET $2`,
            [limit, offset]
          ),
          query<CountRow>(
            `SELECT COUNT(*) AS count FROM (
               SELECT DISTINCT from_address AS addr FROM evm_transactions WHERE from_address IS NOT NULL
               UNION
               SELECT DISTINCT to_address AS addr FROM evm_transactions WHERE to_address IS NOT NULL
             ) all_holders`
          ),
        ]);

        const totalSupplyWei = 1_000_000_000e18; // 1B LITHO in wei
        const holders = await Promise.all(rows.map(async (r) => {
          const liveBal = await fetchLiveBalance(r.address);
          const balUlitho = weiToUlitho(liveBal);
          return {
            address: r.address,
            balance: balUlitho,
            percentage: totalSupplyWei > 0 ? (parseFloat(liveBal) / totalSupplyWei) * 100 : 0,
          };
        }));

        // Sort dynamically fetched balances correctly
        holders.sort((a, b) => {
          const balA = BigInt(a.balance);
          const balB = BigInt(b.balance);
          return balA < balB ? 1 : balA > balB ? -1 : 0;
        });

        res.json({
          holders,
          total: parseInt(countResult[0]?.count ?? '0'),
          limit,
          offset,
        });
      } else {
        // LEP100: derive holders from evm_transactions involving this contract
        const addrLower = address.toLowerCase();
        const [rows, countResult] = await Promise.all([
          query<{ address: string; tx_count: string }>(
            `SELECT addr AS address, COUNT(*) AS tx_count FROM (
               SELECT from_address AS addr FROM evm_transactions WHERE LOWER(to_address) = $1 OR LOWER(contract_address) = $1
               UNION ALL
               SELECT to_address AS addr FROM evm_transactions WHERE LOWER(from_address) = $1
             ) interactions WHERE addr IS NOT NULL
             GROUP BY addr ORDER BY tx_count DESC LIMIT $2 OFFSET $3`,
            [addrLower, limit, offset]
          ),
          query<CountRow>(
            `SELECT COUNT(DISTINCT addr) AS count FROM (
               SELECT from_address AS addr FROM evm_transactions WHERE LOWER(to_address) = $1 OR LOWER(contract_address) = $1
               UNION ALL
               SELECT to_address AS addr FROM evm_transactions WHERE LOWER(from_address) = $1
             ) interactions WHERE addr IS NOT NULL`,
            [addrLower]
          ),
        ]);
        res.json({
          holders: rows.map((r) => ({
            address: r.address,
            balance: r.tx_count, // Using tx count as proxy since we don't track ERC20 balances
            percentage: 0,
          })),
          total: parseInt(countResult[0]?.count ?? '0'),
          limit,
          offset,
        });
      }
    } catch (err) {
      console.error('[api] /tokens/:address/holders error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ── LITHO price (USD) ──────────────────────────────────────────────

  // Testnet: fixed price. Mainnet: switch to live API after TGE.
  const TESTNET_PRICE = 5; // $5 USD per LITHO (testnet only)
  const IS_MAINNET = process.env.NETWORK === 'mainnet';

  let priceCache: { price: number; fetchedAt: number } | null = null;
  const PRICE_TTL = 5 * 60 * 1000; // 5 minutes

  r.get('/price', async (_req: Request, res: Response) => {
    try {
      // Testnet: return fixed price
      if (!IS_MAINNET) {
        res.json({ price: TESTNET_PRICE, symbol: 'LITHO', currency: 'USD' });
        return;
      }

      // Mainnet: fetch live price from APIs
      const now = Date.now();
      if (priceCache && now - priceCache.fetchedAt < PRICE_TTL) {
        res.json({ price: priceCache.price, symbol: 'LITHO', currency: 'USD' });
        return;
      }

      let price: number | null = null;
      try {
        const resp = await fetch('https://api.freecryptoapi.com/v1/getData?symbol=LITHO', {
          signal: AbortSignal.timeout(5000),
        });
        if (resp.ok) {
          const data = await resp.json() as Record<string, unknown>;
          const lithoData = (data as { LITHO?: { price?: number } }).LITHO;
          if (lithoData?.price) price = lithoData.price;
        }
      } catch { /* fallback below */ }

      if (price == null) {
        try {
          const resp = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=lithosphere&vs_currencies=usd', {
            signal: AbortSignal.timeout(5000),
          });
          if (resp.ok) {
            const data = await resp.json() as { lithosphere?: { usd?: number } };
            if (data.lithosphere?.usd) price = data.lithosphere.usd;
          }
        } catch { /* no price available */ }
      }

      if (price != null) {
        priceCache = { price, fetchedAt: now };
      }

      res.json({ price: price ?? null, symbol: 'LITHO', currency: 'USD' });
    } catch (err) {
      console.error('[api] /price error:', err);
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
      console.error('[api] /faucet/info error:', err);
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
        console.warn('[api] Rejecting faucet claim: missing address');
        res.status(400).json({ ok: false, message: 'Wallet address is required.' });
        return;
      }

      // Validate address format
      const isEvm = /^0x[a-fA-F0-9]{40}$/.test(normalizedAddress);
      const isCosmos = normalizedAddress.startsWith('litho1');
      if (!isEvm && !isCosmos) {
        console.warn(`[api] Rejecting faucet claim: invalid address format "${normalizedAddress.slice(0, 80)}"`);
        res.status(400).json({ ok: false, message: 'Invalid wallet address. Use a 0x... address.' });
        return;
      }

      // The faucet service only accepts EVM (0x) addresses
      // If cosmos address provided, we can't forward to the EVM faucet
      if (!isEvm) {
        console.warn(`[api] Rejecting faucet claim for non-EVM address: ${normalizedAddress}`);
        res.status(400).json({ ok: false, message: 'The faucet currently supports EVM (0x) addresses only. Please use your 0x address.' });
        return;
      }

      if (normalizedAmount.invalid) {
        console.warn(`[api] Rejecting faucet claim: invalid amount "${String(amount).slice(0, 80)}"`);
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
        console.warn(`[api] Faucet claim failed upstream (${upstream.status}) for ${normalizedAddress}: ${sanitizedMessage}`);
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
        console.warn(`[api] Faucet upstream returned malformed tx hash for ${normalizedAddress}`);
      }

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
      console.error('[api] /faucet/claim error:', err);
      res.status(502).json({
        ok: false,
        message: 'Faucet service is unavailable. Please try again later.',
      });
    }
  });

  return r;
}
