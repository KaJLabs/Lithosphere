import 'dotenv/config';
// Must come before any pg / http / fetch imports — see tracing.ts.
import './tracing.js';
import { createHash } from 'crypto';
import { decodeTxMemo } from './tx-memo.js';
import { bech32 } from 'bech32';
import pkg, { type PoolClient } from 'pg';
const { Pool } = pkg;
import { Gauge, register, collectDefaultMetrics } from 'prom-client';
import express from 'express';
import { readBuildInfo, buildVersionResponse } from './lib/build-info.js';
import { logger, cycleIdStore, newCycleId } from './lib/logger.js';
import {
  parseConfiguredEvmChainId,
  resolveSeededTokens,
  resolveStaleTokenAddresses,
} from './token-registry.js';
import {
  consensusAddressFromPublicKey,
  signingInfoByAddress,
  signingUptime,
  type SigningInfo,
} from './validators.js';

// ─── Config ───────────────────────────────────────────────────────────────────

const RPC_URL = (process.env.RPC_URL || process.env.LITHO_RPC_URL || 'https://rpc.litho.ai').replace(/\/$/, '');
// Derive LCD from RPC: https://rpc.litho.ai → https://api.litho.ai
const LCD_URL = (process.env.REST_URL || process.env.LCD_URL || RPC_URL.replace('://rpc.', '://api.')).replace(/\/$/, '');
const EVM_RPC_URL = (process.env.EVM_RPC_URL || '').replace(/\/$/, '');
const PUBLIC_EVM_RPC_URL = (process.env.PUBLIC_EVM_RPC_URL || '').replace(/\/$/, '');
const EVM_RPC_ENDPOINTS = [...new Set([EVM_RPC_URL, RPC_URL, PUBLIC_EVM_RPC_URL].filter(Boolean))];
const EVM_CHAIN_ID = parseConfiguredEvmChainId(process.env.LITHO_CHAIN_ID);
const START_BLOCK = parseInt(process.env.START_BLOCK || process.env.INDEXER_START_BLOCK || '1');
const BATCH_SIZE = parseInt(process.env.BATCH_SIZE || process.env.INDEXER_BATCH_SIZE || '100');
const POLL_MS = 6000;           // Wait between polls when caught up
const CATCHUP_DELAY_MS = 100;   // Delay between batches during bulk sync
const SYNCING_LAG_THRESHOLD = 1000;
const CONSISTENCY_REPAIR_INTERVAL_MS = 300_000;
const SYNC_SNAPSHOT_REFRESH_MS = 30_000;
const CONSISTENCY_REPAIR_BATCH = 250;

// ─── DB Pool ──────────────────────────────────────────────────────────────────

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
  ssl: process.env.DATABASE_URL?.includes('sslmode=disable')
    ? false
    : { rejectUnauthorized: false },
});
pool.on('error', (err) => logger.error({ err: err.message }, '[db] Pool error'));

// ─── Prometheus ───────────────────────────────────────────────────────────────

collectDefaultMetrics({ prefix: 'litho_indexer_' });
const gIndexed = new Gauge({ name: 'litho_indexer_last_indexed_block', help: 'Last indexed block height' });
const gChain   = new Gauge({ name: 'litho_indexer_chain_height',       help: 'Chain tip height' });
const gMaxTxBlock = new Gauge({ name: 'litho_indexer_max_transaction_block', help: 'Latest indexed transaction block height' });
const gInconsistentBlocks = new Gauge({ name: 'litho_indexer_inconsistent_block_count', help: 'Indexed blocks whose transaction count does not match the transactions table' });
const gLag = new Gauge({ name: 'litho_indexer_chain_lag_blocks', help: 'Block lag between the chain tip and the indexed blocks table tip' });

const BUILD_INFO = readBuildInfo();

new Gauge({
  name: 'litho_indexer_build_info',
  help: 'Indexer build metadata. Value is always 1; labels carry git_sha / build_time / version.',
  labelNames: ['git_sha', 'build_time', 'version', 'node_version'],
}).set(
  {
    git_sha: BUILD_INFO.gitSha,
    build_time: BUILD_INFO.buildTime,
    version: BUILD_INFO.version,
    node_version: BUILD_INFO.nodeVersion,
  },
  1,
);

const PROCESS_START = Date.now();

// ─── Types ────────────────────────────────────────────────────────────────────

interface RpcBlock {
  block_id: { hash: string };
  block: {
    header: { height: string; time: string; proposer_address: string };
    data: { txs?: string[] };
  };
}

export interface TxEvent {
  type: string;
  attributes: Array<{ key: string; value: string }>;
}

interface TxResult {
  code: number;
  log: string;
  gas_wanted: string;
  gas_used: string;
  events: TxEvent[];
}

interface RpcBlockResults {
  height: string;
  txs_results: TxResult[] | null;
}

type DbClient = PoolClient;

interface SeedAccount {
  address: string;
  evmAddress: string;
  balance: string;
  accountNumber: number;
}

interface RpcStatus {
  node_info: { network: string };
  sync_info: { latest_block_height: string };
}

interface HeightWithTimeRow {
  height: string;
  timestamp?: Date | string | null;
  block_time?: Date | string | null;
}

interface InconsistentHeightRow {
  height: string;
}

interface IndexerSyncSnapshot {
  chainTip: number;
  lastIndexedBlock: number;
  maxIndexedBlock: number;
  maxTransactionBlock: number;
  latestBlockTimestamp: string | null;
  latestTransactionTimestamp: string | null;
  inconsistentBlockCount: number;
  lagBlocks: number;
  isSyncing: boolean;
  lastResetReason: string | null;
  lastResetAt: string | null;
  lastRepairAt: string | null;
  lastRepairCount: number;
  updatedAt: string;
}

export interface IndexBlockOptions {
  replaceExisting?: boolean;
}

let lastKnownChainTip = 0;
let syncSnapshot: IndexerSyncSnapshot = {
  chainTip: 0,
  lastIndexedBlock: 0,
  maxIndexedBlock: 0,
  maxTransactionBlock: 0,
  latestBlockTimestamp: null,
  latestTransactionTimestamp: null,
  inconsistentBlockCount: 0,
  lagBlocks: 0,
  isSyncing: false,
  lastResetReason: null,
  lastResetAt: null,
  lastRepairAt: null,
  lastRepairCount: 0,
  updatedAt: new Date().toISOString(),
};

const GENESIS_ACCOUNTS: SeedAccount[] = [
  { address: 'litho1jqa20fhuxlceg7mwflpcxgfe4r2p2g2f0nrnj5', evmAddress: '0x903AA7a6fc37F1947B6e4fC3832139A8D4152149', balance: '190000000000000000000000000', accountNumber: 1 },
  { address: 'litho1fe7hgzhc384dejgzlycyx9t80ere4vakcnphsm', evmAddress: '0x4E7d740Af889EADcC902F9304315677E479aB3b6', balance: '190000000000000000000000000', accountNumber: 2 },
  { address: 'litho13qvmr0wdwun3rqq5qqahqxvzm8c3559pfwwwr0', evmAddress: '0x8819B1BdcD7727118014003b701982d9F11A50a1', balance: '50000000000000000000000000', accountNumber: 3 },
  { address: 'litho1yzxrtd9uetfy5hmzzzqhq2sv2yteaafzes2e67', evmAddress: '0x208c35b4bCCAd24a5F621081702a0C51179Ef522', balance: '50000000000000000000000000', accountNumber: 4 },
  { address: 'litho1v43usrfpru2t7caph9snajs7nf5j2ghuqwxyfc', evmAddress: '0x6563c80D211f14bf63a1B9613ECA1e9a692522Fc', balance: '75000000000000000000000000', accountNumber: 5 },
  { address: 'litho17y8ecmw5p0e5kmvuq2q3m3t98hwz0r2t8su5ng', evmAddress: '0xF10f9C6Dd40bF34B6d9c02811dC5653dDc278D4b', balance: '75000000000000000000000000', accountNumber: 6 },
  { address: 'litho12sdvp8mtl9elhec5mk630u3ge9t8hj5p383gu9', evmAddress: '0x541ac09f6bf973fbe714ddb517f228c9567bca81', balance: '50000000000000000000000000', accountNumber: 7 },
  { address: 'litho1kuaqzyng4prjn7cp45qel58nqweajx7mx45ayp', evmAddress: '0xb73a011268a84729fb01ad019fd0f303b3d91bdb', balance: '50000000000000000000000000', accountNumber: 8 },
  { address: 'litho13rf5cdrsrk073gl3npslv857ya7uufww5437lz', evmAddress: '0x88d34c34701d9fe8a3f19861f61e9e277dce25ce', balance: '25000000000000000000000000', accountNumber: 9 },
  { address: 'litho1kaltpxap8ymlfcykekggpgt228zst3lly2t6mm', evmAddress: '0xb77eb09ba13937f4e096cd9080a16a51c505c7ff', balance: '25000000000000000000000000', accountNumber: 10 },
  { address: 'litho1spzck5q8cymezjyaqw62g8s6hjfsg8cxqsrvww', evmAddress: '0x80458b5007c13791489d03b4a41e1abc93041f06', balance: '35000000000000000000000000', accountNumber: 11 },
  { address: 'litho1h4cl2cxaxzzfxw7qgamn2zuj7cfwjwts6w6rkw', evmAddress: '0xbd71f560dd3084933bc04777350b92f612e93970', balance: '35000000000000000000000000', accountNumber: 12 },
  { address: 'litho14c3y86hfd69kwqmdkup9y90ertu53cu6ewpr7h', evmAddress: '0xae2243eae96e8b67036db7025215f91af948e39a', balance: '40000000000000000000000000', accountNumber: 13 },
  { address: 'litho1g5vc8rcxla03p2456gsfayevpwt44yhxm72naj', evmAddress: '0x4519838f06ff5f10aab4d2209e932c0b975a92e6', balance: '40000000000000000000000000', accountNumber: 14 },
  { address: 'litho187m5cwfthxyspdzrpqvzs9c6f6k5gzenw8lkq2', evmAddress: '0x3fb74c392BB98900b443081828171a4Ead440B33', balance: '70000000000000000000000000', accountNumber: 15 },
];

const SEEDED_TOKENS = resolveSeededTokens(EVM_CHAIN_ID);
const STALE_TOKEN_ADDRESSES = resolveStaleTokenAddresses(EVM_CHAIN_ID);

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Strip trailing '=' padding from a base64-encoded string without regex.
 *
 * Avoids the `/=+$/` regex pattern CodeQL flags as `js/polynomial-redos`
 * on attribute values that come in from the indexer's CometBFT poller \u2014
 * even though the engine's worst case for that particular regex is O(n),
 * a non-regex strip is unambiguously linear and reads more clearly.
 */
function stripBase64Padding(s: string): string {
  let end = s.length;
  while (end > 0 && s.charCodeAt(end - 1) === 0x3d /* '=' */) end--;
  return end === s.length ? s : s.slice(0, end);
}

/** Safely decode a CometBFT base64-encoded attribute. Returns null if not valid base64. */
export function tryBase64(s: string): string | null {
  if (!s) return null;
  try {
    const buf = Buffer.from(s, 'base64');
    // Only accept if round-trip matches (i.e. string is genuine base64, not plain text)
    if (stripBase64Padding(buf.toString('base64')) !== stripBase64Padding(s)) return null;
    const d = buf.toString('utf-8');
    // Reject if it contains replacement characters (invalid UTF-8)
    if (d.includes('\uFFFD')) return null;
    return d;
  } catch { return null; }
}

/** Get the first matching event attribute value. Handles both plain and base64-encoded attributes. */
export function attr(events: TxEvent[], eventType: string, key: string): string {
  for (const ev of events) {
    if (ev.type !== eventType) continue;
    for (const a of ev.attributes) {
      // Try plain text first, then base64-decoded
      const rawKey = a.key;
      if (rawKey === key) return a.value;
      const decodedKey = tryBase64(rawKey);
      if (decodedKey === key) {
        // Keys are base64-encoded, so decode the value too
        return tryBase64(a.value) ?? a.value;
      }
    }
  }
  return '';
}

/** Scan each `eventType` event as a group, collecting tuples of the requested keys. */
export function attrTuples(events: TxEvent[], eventType: string, keys: string[]): Record<string, string>[] {
  const out: Record<string, string>[] = [];
  for (const ev of events) {
    if (ev.type !== eventType) continue;
    const row: Record<string, string> = {};
    for (const a of ev.attributes) {
      const rawKey = a.key;
      if (keys.includes(rawKey)) { row[rawKey] = a.value; continue; }
      const decodedKey = tryBase64(rawKey);
      if (decodedKey && keys.includes(decodedKey)) {
        row[decodedKey] = tryBase64(a.value) ?? a.value;
      }
    }
    if (Object.keys(row).length) out.push(row);
  }
  return out;
}

const RPC_RETRY_ATTEMPTS = Math.max(1, Number(process.env.RPC_RETRY_ATTEMPTS || 6));
const RPC_RETRY_BASE_MS = Math.max(0, Number(process.env.RPC_RETRY_BASE_MS || 250));
const RPC_RETRY_MAX_MS = Math.max(RPC_RETRY_BASE_MS, Number(process.env.RPC_RETRY_MAX_MS || 5_000));
const RETRYABLE_RPC_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

function rpcRetryDelay(resp: Response | null, attempt: number): number {
  const retryAfter = resp?.headers.get('retry-after');
  if (retryAfter != null && /^\d+(?:\.\d+)?$/.test(retryAfter.trim())) {
    return Math.min(RPC_RETRY_MAX_MS, Math.max(0, Math.ceil(Number(retryAfter) * 1_000)));
  }
  return Math.min(RPC_RETRY_MAX_MS, RPC_RETRY_BASE_MS * (2 ** Math.max(0, attempt - 1)));
}

/** Fetch from CometBFT JSON-RPC, retrying transient gateway/rate-limit failures. */
async function rpcGet<T>(path: string): Promise<T> {
  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= RPC_RETRY_ATTEMPTS; attempt++) {
    let resp: Response | null = null;
    try {
      resp = await fetch(`${RPC_URL}${path}`, { signal: AbortSignal.timeout(30_000) });
      if (resp.ok) {
        const json = await resp.json() as { result?: T; error?: { message: string } };
        if (json.error) throw new Error(`RPC error on ${path}: ${json.error.message}`);
        return json.result as T;
      }
      lastError = new Error(`RPC ${path} -> HTTP ${resp.status}`);
      if (!RETRYABLE_RPC_STATUS.has(resp.status)) throw lastError;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (resp && !RETRYABLE_RPC_STATUS.has(resp.status)) throw lastError;
    }

    if (attempt >= RPC_RETRY_ATTEMPTS) break;
    const delay = rpcRetryDelay(resp, attempt);
    logger.warn({ path, attempt, status: resp?.status, delay }, 'rpc_request_retry');
    await new Promise(resolve => setTimeout(resolve, delay));
  }
  throw lastError ?? new Error(`RPC ${path} failed`);
}

async function getLastIndexedBlock(): Promise<number> {
  const r = await pool.query<{ value: string }>(
    `SELECT value FROM indexer_state WHERE key = 'last_indexed_block'`
  );
  return parseInt(r.rows[0]?.value ?? '0') || 0;
}

async function setLastIndexedBlock(height: number): Promise<void> {
  await pool.query(
    `INSERT INTO indexer_state (key, value, updated_at)
     VALUES ('last_indexed_block', $1, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [String(height)]
  );
  gIndexed.set(height);
}

async function setLastIndexedEvmBlock(height: number): Promise<void> {
  if (EVM_RPC_ENDPOINTS.length === 0) return;
  await setIndexerState('last_indexed_evm_block', String(height));
}

async function getIndexerState(key: string): Promise<string | null> {
  const r = await pool.query<{ value: string }>(
    'SELECT value FROM indexer_state WHERE key = $1',
    [key]
  );
  return r.rows[0]?.value ?? null;
}

async function setIndexerState(key: string, value: string): Promise<void> {
  await pool.query(
    `INSERT INTO indexer_state (key, value, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [key, value]
  );
}

export function parseIntSafe(value: string | number | null | undefined): number {
  const parsed = typeof value === 'number' ? value : parseInt(value ?? '0', 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function toIsoString(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
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

async function getInconsistentBlockCount(): Promise<number> {
  const rows = await pool.query<{ count: string }>(`
    ${INCONSISTENT_BLOCKS_CTE}
    SELECT COUNT(*) AS count FROM inconsistent_blocks
  `);
  return parseIntSafe(rows.rows[0]?.count);
}

async function findInconsistentBlockHeights(limit: number): Promise<number[]> {
  const rows = await pool.query<InconsistentHeightRow>(`
    ${INCONSISTENT_BLOCKS_CTE}
    SELECT height::text AS height
    FROM inconsistent_blocks
    ORDER BY height ASC
    LIMIT $1
  `, [limit]);
  return rows.rows
    .map((row) => parseIntSafe(row.height))
    .filter((height) => height > 0);
}

async function refreshSyncSnapshot(chainTip = lastKnownChainTip): Promise<IndexerSyncSnapshot> {
  const [
    lastIndexedBlock,
    maxIndexedBlockRow,
    maxTransactionBlockRow,
    inconsistentBlockCount,
    lastResetReason,
    lastResetAt,
    lastRepairAt,
    lastRepairCount,
  ] = await Promise.all([
    getLastIndexedBlock().catch(() => 0),
    pool.query<HeightWithTimeRow>(
      'SELECT COALESCE(MAX(height), 0)::text AS height, MAX(block_time) AS block_time FROM blocks'
    ).catch(() => ({ rows: [] as HeightWithTimeRow[] })),
    pool.query<HeightWithTimeRow>(
      'SELECT COALESCE(MAX(block_height), 0)::text AS height, MAX(timestamp) AS timestamp FROM transactions'
    ).catch(() => ({ rows: [] as HeightWithTimeRow[] })),
    getInconsistentBlockCount().catch(() => 0),
    getIndexerState('last_reset_reason').catch(() => null),
    getIndexerState('last_reset_at').catch(() => null),
    getIndexerState('last_repair_at').catch(() => null),
    getIndexerState('last_repair_count').catch(() => null),
  ]);

  const maxIndexedBlock = parseIntSafe(maxIndexedBlockRow.rows[0]?.height);
  const maxTransactionBlock = parseIntSafe(maxTransactionBlockRow.rows[0]?.height);
  const effectiveChainTip = Math.max(0, chainTip);
  const lagBlocks = effectiveChainTip > 0
    ? Math.max(0, effectiveChainTip - maxIndexedBlock)
    : Math.max(0, lastIndexedBlock - maxIndexedBlock);

  syncSnapshot = {
    chainTip: effectiveChainTip,
    lastIndexedBlock,
    maxIndexedBlock,
    maxTransactionBlock,
    latestBlockTimestamp: toIsoString(maxIndexedBlockRow.rows[0]?.block_time),
    latestTransactionTimestamp: toIsoString(maxTransactionBlockRow.rows[0]?.timestamp),
    inconsistentBlockCount,
    lagBlocks,
    isSyncing: lagBlocks > SYNCING_LAG_THRESHOLD,
    lastResetReason,
    lastResetAt,
    lastRepairAt,
    lastRepairCount: parseIntSafe(lastRepairCount),
    updatedAt: new Date().toISOString(),
  };

  gIndexed.set(lastIndexedBlock);
  gMaxTxBlock.set(maxTransactionBlock);
  gInconsistentBlocks.set(inconsistentBlockCount);
  gLag.set(lagBlocks);

  return syncSnapshot;
}

async function repairInconsistentBlocks(limit = CONSISTENCY_REPAIR_BATCH): Promise<number> {
  const heights = await findInconsistentBlockHeights(limit);
  if (heights.length === 0) {
    await setIndexerState('last_repair_count', '0');
    return 0;
  }

  logger.warn({ count: heights.length }, '[indexer] Repairing inconsistent block(s)');
  let repaired = 0;
  for (const height of heights) {
    try {
      await indexBlock(height, { replaceExisting: true });
      repaired += 1;
    } catch (err) {
      logger.warn(
        { height, err: err instanceof Error ? err.message : String(err) },
        '[indexer] Consistency repair failed',
      );
    }
  }

  await Promise.all([
    setIndexerState('last_repair_at', new Date().toISOString()),
    setIndexerState('last_repair_count', String(repaired)),
  ]);

  return repaired;
}

async function resetIndexedData(reason: string): Promise<void> {
  logger.warn({ reason }, '[indexer] Resetting indexed data');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const resetAt = new Date().toISOString();
    await client.query(`
      TRUNCATE TABLE
        token_transfers,
        evm_transactions,
        transactions,
        contracts,
        accounts,
        validators,
        proposals,
        network_stats,
        blocks
      RESTART IDENTITY CASCADE
    `);
    await client.query(`
      INSERT INTO indexer_state (key, value, updated_at) VALUES
        ('last_indexed_block', '0', NOW()),
        ('last_indexed_evm_block', '0', NOW()),
        ('last_reset_reason', $1, NOW()),
        ('last_reset_at', $2, NOW())
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
    `, [reason, resetAt]);
    await client.query('COMMIT');
    gIndexed.set(0);
    gMaxTxBlock.set(0);
    gInconsistentBlocks.set(0);
    syncSnapshot = {
      ...syncSnapshot,
      lastIndexedBlock: 0,
      maxIndexedBlock: 0,
      maxTransactionBlock: 0,
      latestBlockTimestamp: null,
      latestTransactionTimestamp: null,
      inconsistentBlockCount: 0,
      lagBlocks: Math.max(0, lastKnownChainTip),
      isSyncing: Math.max(0, lastKnownChainTip) > SYNCING_LAG_THRESHOLD,
      lastResetReason: reason,
      lastResetAt: resetAt,
      updatedAt: new Date().toISOString(),
    };
    gLag.set(syncSnapshot.lagBlocks);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function seedGenesisAccounts(): Promise<void> {
  for (const account of GENESIS_ACCOUNTS) {
    await pool.query(
      `INSERT INTO accounts
         (address, evm_address, balance, sequence, account_number, account_type, first_seen_block, last_seen_block, tx_count)
       VALUES ($1, $2, $3, 0, $4, 'genesis', 1, 1, 0)
       ON CONFLICT (address) DO NOTHING`,
      [account.address, account.evmAddress, account.balance, account.accountNumber]
    );
  }
}

async function assertEvmSeedNetwork(): Promise<void> {
  const reported = await evmRpc<string>('eth_chainId', []);
  if (!reported || !/^0x[0-9a-f]+$/i.test(reported)) {
    throw new Error('Unable to verify EVM chain ID before token registry migration');
  }

  const reportedChainId = Number.parseInt(reported.slice(2), 16);
  if (reportedChainId !== EVM_CHAIN_ID) {
    throw new Error(
      `EVM chain ID mismatch: configured ${EVM_CHAIN_ID}, RPC reported ${reportedChainId}`,
    );
  }
}

async function assertSeedTokenCode(): Promise<void> {
  const checks = await Promise.all(
    SEEDED_TOKENS.map(async (token) => ({
      token,
      code: await evmRpc<string>('eth_getCode', [token.address, 'latest']),
    })),
  );
  const invalid = checks
    .filter(({ code }) => !code || code === '0x' || code === '0x0')
    .map(({ token }) => `${token.symbol}:${token.address}`);

  if (invalid.length > 0) {
    throw new Error(`Refusing to seed token address(es) without contract code: ${invalid.join(', ')}`);
  }
}

async function migrateTokenAddresses(): Promise<void> {
  if (STALE_TOKEN_ADDRESSES.length === 0) return;
  const placeholders = STALE_TOKEN_ADDRESSES.map((_, i) => `$${i + 1}`).join(', ');
  const addrs = STALE_TOKEN_ADDRESSES.map((address) => address.toLowerCase());
  await pool.query(`DELETE FROM token_transfers WHERE lower(contract_address) IN (${placeholders})`, addrs);
  await pool.query(`DELETE FROM contracts WHERE lower(address) IN (${placeholders})`, addrs);
}

async function seedTokenContracts(): Promise<void> {
  for (const token of SEEDED_TOKENS) {
    await pool.query(
      `INSERT INTO contracts (address, name, symbol, decimals, total_supply, contract_type)
       VALUES ($1, $2, $3, $4, $5, 'token')
       ON CONFLICT (address) DO UPDATE SET
         name = EXCLUDED.name,
         symbol = EXCLUDED.symbol,
         decimals = EXCLUDED.decimals,
         total_supply = EXCLUDED.total_supply,
         contract_type = 'token',
         updated_at = NOW()`,
      [token.address, token.name, token.symbol, token.decimals, token.totalSupply]
    );
  }
}

async function seedStaticData(): Promise<void> {
  try {
    await seedGenesisAccounts();
    logger.info({ count: GENESIS_ACCOUNTS.length }, '[indexer] Genesis accounts seeded');
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, '[indexer] Genesis account seed failed');
  }

  try {
    await assertEvmSeedNetwork();
    await assertSeedTokenCode();
    await migrateTokenAddresses();
    await seedTokenContracts();
    const tokenCount = await pool.query("SELECT COUNT(*) AS count FROM contracts WHERE contract_type = 'token'");
    logger.info(
      {
        chainId: EVM_CHAIN_ID,
        registryTokens: SEEDED_TOKENS.length,
        totalTokens: tokenCount.rows[0]?.count ?? 0,
      },
      '[indexer] Chain-specific LEP100 registry applied',
    );
  } catch (err) {
    logger.error(
      { chainId: EVM_CHAIN_ID, err: err instanceof Error ? err.message : String(err) },
      '[indexer] Token registry update refused or failed',
    );
    throw err;
  }
}

async function ensureChainConsistency(forceReset: boolean): Promise<void> {
  const [status, genesisBlock] = await Promise.all([
    rpcGet<RpcStatus>('/status'),
    rpcGet<RpcBlock>('/block?height=1'),
  ]);

  const currentChainId = status.node_info.network;
  const currentGenesisHash = genesisBlock.block_id.hash.toLowerCase();
  const currentGenesisTime = genesisBlock.block.header.time;

  const [storedChainId, storedGenesisHash, dbGenesis] = await Promise.all([
    getIndexerState('chain_id').catch(() => null),
    getIndexerState('genesis_hash').catch(() => null),
    pool.query<{ hash: string }>('SELECT hash FROM blocks WHERE height = 1').catch(() => ({ rows: [] as Array<{ hash: string }> })),
  ]);

  const dbGenesisHash = dbGenesis.rows[0]?.hash?.toLowerCase() ?? null;
  let resetReason: string | null = null;

  if (forceReset) {
    resetReason = 'FORCE_REINDEX=1';
  } else if (storedChainId && storedChainId !== currentChainId) {
    resetReason = `chain_id changed (${storedChainId} -> ${currentChainId})`;
  } else if (storedGenesisHash && storedGenesisHash.toLowerCase() !== currentGenesisHash) {
    resetReason = `genesis hash changed (${storedGenesisHash} -> ${currentGenesisHash})`;
  } else if (dbGenesisHash && dbGenesisHash !== currentGenesisHash) {
    resetReason = `blocks.height=1 hash mismatch (${dbGenesisHash} -> ${currentGenesisHash})`;
  }

  if (resetReason) {
    await resetIndexedData(resetReason);
  }

  await setIndexerState('chain_id', currentChainId);
  await setIndexerState('genesis_hash', currentGenesisHash);
  await setIndexerState('genesis_time', currentGenesisTime);
}

// ─── Block Indexing ───────────────────────────────────────────────────────────

export async function indexBlock(height: number, options: IndexBlockOptions = {}): Promise<void> {
  const [blockData, resultsData] = await Promise.all([
    rpcGet<RpcBlock>(`/block?height=${height}`),
    rpcGet<RpcBlockResults>(`/block_results?height=${height}`),
  ]);

  const rawTxs    = blockData.block.data.txs ?? [];
  const txResults = resultsData.txs_results ?? [];
  const totalGas  = txResults.reduce((s, r) => s + parseInt(r.gas_used || '0'), 0);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    if (options.replaceExisting) {
      await client.query('DELETE FROM token_transfers WHERE block_height = $1', [height]);
      await client.query('DELETE FROM evm_transactions WHERE block_height = $1', [height]);
      await client.query('DELETE FROM transactions WHERE block_height = $1', [height]);
      await client.query('DELETE FROM contracts WHERE creation_block = $1', [height]);
      await client.query('DELETE FROM blocks WHERE height = $1', [height]);
    }

    await client.query(
      `INSERT INTO blocks (height, hash, proposer_address, num_txs, total_gas, block_time)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (height) DO UPDATE SET
         hash = EXCLUDED.hash,
         proposer_address = EXCLUDED.proposer_address,
         num_txs = EXCLUDED.num_txs,
         total_gas = EXCLUDED.total_gas,
         block_time = EXCLUDED.block_time`,
      [
        height,
        blockData.block_id.hash.toLowerCase(),
        blockData.block.header.proposer_address.toLowerCase(),
        rawTxs.length,
        totalGas,
        blockData.block.header.time,
      ]
    );

    for (let i = 0; i < rawTxs.length; i++) {
      const txBytes = Buffer.from(rawTxs[i], 'base64');
      const txHash  = createHash('sha256').update(txBytes).digest('hex').toUpperCase();
      const result  = txResults[i];
      if (result) {
        await indexTx(client, txHash, height, i, blockData.block.header.time, result, txBytes);
      }
    }

    await client.query('COMMIT');
    if (rawTxs.length > 0) {
      logger.info({ height, txCount: rawTxs.length }, '[indexer] Block indexed');
    }
  } catch (err) {
    await client.query('ROLLBACK');
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ height, err: msg }, '[indexer] Block FAILED');
    // Log the first block failure in detail to help diagnose schema mismatches
    if (height <= 10 || rawTxs.length > 0) {
      logger.error(
        { height, txs: rawTxs.length, hash: blockData.block_id.hash.substring(0, 16) },
        '[indexer] Block failure detail',
      );
    }
    throw err;
  } finally {
    client.release();
  }
}

// ─── Transaction Indexing ─────────────────────────────────────────────────────

async function indexTx(
  client: DbClient,
  hash: string,
  height: number,
  index: number,
  blockTime: string,
  result: TxResult,
  txBytes: Uint8Array
): Promise<void> {
  const evts    = result.events ?? [];
  const success = result.code === 0;
  const gasUsed = parseInt(result.gas_used   || '0');
  const gasWant = parseInt(result.gas_wanted || '0');

  // Action / tx type (e.g. "/cosmos.bank.v1beta1.MsgSend" → "MsgSend")
  const action = attr(evts, 'message', 'action');
  const txType = action ? (action.split('.').pop() ?? action) : 'Unknown';
  const isEvm  = txType === 'MsgEthereumTx';
  // Log EVM tx details for diagnostics (non-EVM txs are too frequent)
  if (isEvm) logger.info({ height, hash: hash.substring(0, 16), action }, '[tx] EVM tx');

  // Sender / receiver / amount — pulled from emitted events (no protobuf needed).
  // Cosmos SDK emits the fee transfer FIRST (sender → fee_collector), then the
  // actual MsgSend transfer. Using the first match would surface fee_collector as
  // the recipient and the fee amount as the value. We skip the fee transfer by
  // matching against the tx fee string and prefer the last non-fee transfer.
  const sender   = attr(evts, 'message', 'sender')          ||
                   attr(evts, 'transfer', 'sender')          || '';

  const feeStr   = attr(evts, 'tx', 'fee') || '';
  const transfers = attrTuples(evts, 'transfer', ['sender', 'recipient', 'amount']);
  const nonFee    = transfers.filter((t) => !feeStr || t.amount !== feeStr);
  const primary   = nonFee[nonFee.length - 1] ?? transfers[transfers.length - 1];
  const receiver = primary?.recipient ?? attr(evts, 'coin_received', 'receiver') ?? '';
  const rawAmt   = primary?.amount    ?? attr(evts, 'coin_received', 'amount')    ?? '0';

  // Parse "1234567ulitho" → amount + denom
  const amtMatch = rawAmt.match(/^(\d+)([a-zA-Z/]+)$/);
  const amount   = amtMatch?.[1] ?? '0';
  const denom    = amtMatch?.[2] ?? 'ulitho';

  // Fee
  const feeMatch = feeStr.match(/^(\d+)([a-zA-Z/]+)$/);
  const fee      = feeMatch?.[1] ?? '0';
  const feeDenom = feeMatch?.[2] ?? 'ulitho';
  let memo = '';
  try { memo = decodeTxMemo(txBytes); } catch (error) {
    // Rejected malformed transactions must not stall block indexing.
    if (success) throw error;
  }

  if (sender)                   await upsertAccount(client, sender,   height);
  if (receiver && receiver !== sender) await upsertAccount(client, receiver, height);

  await client.query(
    `INSERT INTO transactions
       (hash, block_height, tx_index, tx_type, sender, receiver, amount, denom,
        gas_used, gas_wanted, fee, fee_denom, success, memo, raw_log, timestamp)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
     ON CONFLICT (hash) DO UPDATE SET memo = EXCLUDED.memo`,
    [
      hash, height, index, txType,
      sender   || null,
      receiver || null,
      amount, denom,
      gasUsed, gasWant,
      fee, feeDenom,
      success,
      memo,
      result.log?.substring(0, 2000) || '',
      blockTime,
    ]
  );

  // EVM transaction
  if (isEvm) {
    const evmHash = attr(evts, 'ethereum_tx', 'ethereumTxHash');
    if (evmHash) {
      logger.info({ evmHash, cosmosHash: hash, height }, '[evm] Indexing EVM tx');
      await indexEvmTx(client, evmHash, hash, height, index, blockTime, evts, result, gasUsed);
    } else {
      logger.warn({ height }, '[evm] MsgEthereumTx has no ethereumTxHash event');
    }
  }
}

// ─── EVM Transaction Indexing ─────────────────────────────────────────────────

// ERC20 / ERC721 Transfer(from, to, value|tokenId)
//   - 3 topics → ERC20 fungible, value in data
//   - 4 topics → ERC721 NFT, tokenId in topics[3]
const ERC20_TRANSFER_TOPIC =
  '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

// LEP100 (ERC1155-style) TransferSingle(operator, from, to, id, value)
//   4 topics; (id, value) packed in data. Used by Lep100.sol fungibles like
//   DOGE, FGPT, MUSA, etc. — they emit TransferSingle, NOT the ERC20 Transfer.
const LEP100_TRANSFER_SINGLE_TOPIC =
  '0xc3d58168c5ae7397731d063d5bbf3d657854427343f4c083240f7aacaa2d0f62';

interface RpcEvmReceipt {
  logs?: Array<{
    address: string;
    topics: string[];
    data: string;
    logIndex: string;
  }>;
}

interface RpcEvmTx {
  from: string;
  to: string | null;
  value: string;
  gasPrice: string;
  gas: string;
  nonce: string;
  input: string;
}

async function evmRpc<T>(method: string, params: unknown[]): Promise<T | null> {
  if (EVM_RPC_ENDPOINTS.length === 0) return null;

  for (const endpoint of EVM_RPC_ENDPOINTS) {
    try {
      const r = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!r.ok) {
        logger.warn({ method, status: r.status, endpoint }, '[evm] HTTP error');
        continue;
      }
      const j = await r.json() as { result?: T; error?: { message?: string } | unknown };
      if (j.error) {
        const msg = typeof j.error === 'object' && j.error && 'message' in j.error
          ? String((j.error as { message?: string }).message ?? 'unknown error')
          : String(j.error);
        logger.warn({ method, endpoint, rpcError: msg }, '[evm] RPC error');
        continue;
      }
      if (j.result != null) {
        return j.result;
      }
    } catch (err) {
      logger.warn({ method, endpoint, err: err instanceof Error ? err.message : String(err) }, '[evm] request failed');
    }
  }

  return null;
}

export function topicToAddress(topic: string | undefined): string | null {
  if (!topic || topic.length < 42) return null;
  return ('0x' + topic.slice(-40)).toLowerCase();
}

async function indexEvmTx(
  client: DbClient,
  evmHash: string,
  cosmosTxHash: string,
  height: number,
  txIndex: number,
  blockTime: string,
  evts: TxEvent[],
  result: TxResult,
  gasUsed: number
): Promise<void> {
  // Initial values from Cosmos events
  let fromAddr = (attr(evts, 'message', 'sender') || '').toLowerCase();
  let toAddr: string | null = (attr(evts, 'ethereum_tx', 'recipient') || '').toLowerCase() || null;
  let value    = '0';
  let gasPrice = '0';
  let gasLimit = gasUsed;
  let nonce    = 0;
  let input    = '';
  let receipt: RpcEvmReceipt | null = null;

  // Enrich with EVM JSON-RPC details when available (tx + receipt in parallel)
  if (EVM_RPC_ENDPOINTS.length > 0) {
    try {
      const [tx, rcpt] = await Promise.all([
        evmRpc<RpcEvmTx>('eth_getTransactionByHash', [evmHash]),
        evmRpc<RpcEvmReceipt>('eth_getTransactionReceipt', [evmHash]),
      ]);
      if (tx) {
        fromAddr = (tx.from ?? fromAddr).toLowerCase();
        toAddr   = tx.to ? tx.to.toLowerCase() : null;
        value    = String(BigInt(tx.value    ?? '0x0'));
        gasPrice = String(BigInt(tx.gasPrice ?? '0x0'));
        gasLimit = Number(BigInt(tx.gas   ?? '0x0'));
        nonce    = Number(BigInt(tx.nonce ?? '0x0'));
        input    = tx.input ?? '';
      }
      receipt = rcpt;
    } catch (err) {
      logger.warn({ evmHash, err: err instanceof Error ? err.message : String(err) }, '[evm] RPC enrichment failed');
    }
  }

  const contractAddr = !toAddr
    ? (attr(evts, 'ethereum_tx', 'contractAddress') || null)
    : null;

  await client.query(
    `INSERT INTO evm_transactions
       (hash, cosmos_tx_hash, block_height, tx_index,
        from_address, to_address, value, gas_price, gas_limit, gas_used,
        nonce, input_data, contract_address, status, timestamp)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
     ON CONFLICT (hash) DO NOTHING`,
    [
      evmHash, cosmosTxHash, height, txIndex,
      fromAddr, toAddr,
      value, gasPrice, gasLimit, gasUsed,
      nonce, input.substring(0, 4096),
      contractAddr,
      result.code === 0,
      blockTime,
    ]
  );

  // Track contract deployments
  if (contractAddr && fromAddr) {
    await client.query(
      `INSERT INTO contracts (address, creator, creation_tx, creation_block)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (address) DO NOTHING`,
      [contractAddr, fromAddr, evmHash, height]
    );
  }

  // Index LEP100/ERC20 Transfer event logs into token_transfers
  if (receipt?.logs?.length) {
    await indexTransferLogs(client, evmHash, height, blockTime, receipt.logs);
  }
}

export interface DecodedTransfer {
  from: string;
  to: string;
  value: string;
  tokenId: string | null;
}

/**
 * Decode an EVM log into a token transfer record. Returns null if the log
 * is not a recognized transfer event.
 *
 * Handled signatures:
 *  - ERC20 Transfer(from, to, value)         — 3 topics, value in data
 *  - ERC721 Transfer(from, to, tokenId)      — 4 topics, tokenId in topics[3]
 *  - LEP100 TransferSingle(operator, from, to, id, value)
 *                                            — 4 topics, (id, value) in data;
 *                                              tokenId is left null because
 *                                              LEP100 is used for fungibles
 *                                              (id is always 0 in practice).
 *
 * Note: TransferBatch is not yet handled — the (tx_hash, log_index) unique
 * constraint on token_transfers permits at most one row per log, so a batch
 * with N (id, value) pairs would need a schema change to store fully.
 */
export function decodeTransferLog(log: { topics: string[]; data: string }): DecodedTransfer | null {
  const topic0 = log.topics[0]?.toLowerCase();
  if (!topic0) return null;

  if (topic0 === ERC20_TRANSFER_TOPIC) {
    const isNft = log.topics.length === 4;
    if (log.topics.length !== 3 && !isNft) return null;
    const from = topicToAddress(log.topics[1]);
    const to = topicToAddress(log.topics[2]);
    if (!from || !to) return null;
    if (isNft) {
      try { return { from, to, value: '0', tokenId: String(BigInt(log.topics[3])) }; }
      catch { return null; }
    }
    try { return { from, to, value: String(BigInt(log.data || '0x0')), tokenId: null }; }
    catch { return null; }
  }

  if (topic0 === LEP100_TRANSFER_SINGLE_TOPIC) {
    if (log.topics.length !== 4) return null;
    // topics: [sig, operator, from, to]
    const from = topicToAddress(log.topics[2]);
    const to = topicToAddress(log.topics[3]);
    if (!from || !to) return null;
    const data = (log.data || '0x').slice(2);
    if (data.length < 128) return null;
    try {
      // data layout: id (32 bytes) || value (32 bytes)
      const value = String(BigInt('0x' + data.slice(64, 128)));
      return { from, to, value, tokenId: null };
    } catch {
      return null;
    }
  }

  return null;
}

async function indexTransferLogs(
  client: DbClient,
  evmHash: string,
  height: number,
  blockTime: string,
  logs: NonNullable<RpcEvmReceipt['logs']>
): Promise<void> {
  let inserted = 0;
  for (const log of logs) {
    const decoded = decodeTransferLog(log);
    if (!decoded) continue;

    const logIndex = log.logIndex ? Number(BigInt(log.logIndex)) : 0;

    const contractAddress = log.address.toLowerCase();
    await client.query(
      `INSERT INTO token_transfers
         (tx_hash, log_index, contract_address, from_address, to_address, value, token_id, block_height, timestamp)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT ON CONSTRAINT token_transfers_tx_log_unique DO NOTHING`,
      [evmHash, logIndex, contractAddress, decoded.from, decoded.to, decoded.value, decoded.tokenId, height, blockTime]
    );
    inserted++;

    // A non-null token_id means this is an ERC-721 (NFT) Transfer, so classify
    // the emitting contract as an NFT collection. Guarded so a contract already
    // seeded as a fungible 'token' is never reclassified.
    if (decoded.tokenId !== null) {
      await client.query(
        `INSERT INTO contracts (address, contract_type)
         VALUES ($1, 'nft')
         ON CONFLICT (address) DO UPDATE SET
           contract_type = 'nft',
           updated_at = NOW()
         WHERE contracts.contract_type IS DISTINCT FROM 'token'`,
        [contractAddress]
      );
    }
  }
  if (inserted > 0) {
    logger.info({ count: inserted, evmHash: evmHash.substring(0, 16) }, '[evm] Indexed Transfer log(s)');
  }
}

// ─── Token Transfer Backfill ──────────────────────────────────────────────────
//
// One-shot self-heal that runs at startup: if we have evm_transactions but no
// token_transfers (e.g., after rolling out Transfer-log indexing to a DB that
// was already indexed), scan the EVM log history via eth_getLogs in chunks and
// populate token_transfers directly. Avoids a full re-index of every block.
//
// Idempotency: tracked via indexer_state.token_transfers_backfill_v2_completed.
// Re-runnable safely because of the UNIQUE (tx_hash, log_index) constraint.
// Bumped to _v2 to force a re-run after adding LEP100 TransferSingle support
// — the v1 backfill only scanned ERC20 Transfer and missed every LEP100 token.

interface EvmLog {
  address: string;
  topics: string[];
  data: string;
  logIndex: string;
  transactionHash: string;
  blockNumber: string;
}

async function backfillTokenTransfers(): Promise<void> {
  if (EVM_RPC_ENDPOINTS.length === 0) {
    logger.info('[backfill] Token transfers: skipped (no EVM RPC endpoint available)');
    return;
  }

  const marker = await getIndexerState('token_transfers_backfill_v2_completed').catch(() => null);
  if (marker === '1') return;

  const evmRow = await pool.query<{ count: string }>(
    'SELECT COUNT(*) AS count FROM evm_transactions'
  ).catch(() => ({ rows: [{ count: '0' }] }));
  const evmTotal = parseInt(evmRow.rows[0]?.count ?? '0');

  if (evmTotal === 0) {
    // Nothing to backfill; don't mark as complete — let the next EVM activity trigger re-check.
    return;
  }
  // Note: we deliberately do NOT short-circuit when token_transfers already has rows.
  // A v1 backfill may have populated only ERC20 Transfer events and missed every
  // LEP100 TransferSingle event. The unique (tx_hash, log_index) constraint makes
  // re-scanning safe — duplicate ERC20 rows are dropped via ON CONFLICT.

  const rangeQ = await pool.query<{ min_height: string | null; max_height: string | null }>(
    'SELECT MIN(block_height) AS min_height, MAX(block_height) AS max_height FROM evm_transactions'
  );
  const minH = parseInt(rangeQ.rows[0]?.min_height ?? '0');
  const maxH = parseInt(rangeQ.rows[0]?.max_height ?? '0');
  if (!minH || !maxH) return;

  logger.info({ minH, maxH }, '[backfill] Token transfers: scanning blocks for ERC20 Transfer + LEP100 TransferSingle logs');
  const CHUNK = 5000;
  let totalInserted = 0;
  let totalScanned = 0;

  for (let chunkStart = minH; chunkStart <= maxH; chunkStart += CHUNK) {
    const chunkEnd = Math.min(chunkStart + CHUNK - 1, maxH);
    try {
      // Single eth_getLogs request matches either topic via the [[...]] OR filter
      const logs = await evmRpc<EvmLog[]>('eth_getLogs', [{
        fromBlock: '0x' + chunkStart.toString(16),
        toBlock: '0x' + chunkEnd.toString(16),
        topics: [[ERC20_TRANSFER_TOPIC, LEP100_TRANSFER_SINGLE_TOPIC]],
      }]);

      if (!logs || !Array.isArray(logs) || logs.length === 0) continue;
      totalScanned += logs.length;

      const heights = [...new Set(logs.map((l) => Number(BigInt(l.blockNumber))))];
      const tsQ = await pool.query<{ height: string; block_time: Date }>(
        'SELECT height, block_time FROM blocks WHERE height = ANY($1::bigint[])',
        [heights]
      );
      const tsMap = new Map<number, Date>(tsQ.rows.map((r) => [parseInt(r.height), r.block_time]));

      for (const log of logs) {
        const decoded = decodeTransferLog(log);
        if (!decoded) continue;
        const blockHeight = Number(BigInt(log.blockNumber));
        const ts = tsMap.get(blockHeight);
        if (!ts) continue; // block not indexed locally — skip
        const logIndex = log.logIndex ? Number(BigInt(log.logIndex)) : 0;

        const r = await pool.query(
          `INSERT INTO token_transfers
             (tx_hash, log_index, contract_address, from_address, to_address, value, token_id, block_height, timestamp)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
           ON CONFLICT ON CONSTRAINT token_transfers_tx_log_unique DO NOTHING`,
          [log.transactionHash, logIndex, log.address.toLowerCase(), decoded.from, decoded.to, decoded.value, decoded.tokenId, blockHeight, ts]
        );
        totalInserted += r.rowCount ?? 0;
      }
      logger.info({ chunkStart, chunkEnd, scanned: logs.length, insertedSoFar: totalInserted }, '[backfill] Chunk processed');
    } catch (err) {
      logger.warn({ chunkStart, chunkEnd, err: err instanceof Error ? err.message : String(err) }, '[backfill] Chunk failed');
    }
  }

  await setIndexerState('token_transfers_backfill_v2_completed', '1').catch(() => {});
  logger.info({ totalInserted, totalScanned }, '[backfill] Token transfers complete');
}

// ─── NFT Contract Classification Backfill ───────────────────────────────────────
//
// Runtime indexing tags NFT collections as contract_type='nft' the moment they
// emit an ERC-721 transfer (see indexTransferLogs). This one-shot backfill picks
// up collections whose ERC-721 transfers were already indexed before that tagging
// existed. Idempotent: re-runs are a cheap no-op once every collection is tagged.
// Seeded fungible 'token' contracts are never reclassified.
async function backfillNftContractTypes(): Promise<void> {
  try {
    const result = await pool.query(
      `INSERT INTO contracts (address, contract_type)
       SELECT DISTINCT LOWER(contract_address), 'nft'
       FROM token_transfers
       WHERE token_id IS NOT NULL
       ON CONFLICT (address) DO UPDATE SET
         contract_type = 'nft',
         updated_at = NOW()`
    );
    if ((result.rowCount ?? 0) > 0) {
      logger.info({ classified: result.rowCount }, '[backfill] NFT contracts classified');
    }
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, '[backfill] NFT contract classification failed');
  }
}

// ─── Account Upsert ───────────────────────────────────────────────────────────

/**
 * Convert a Cosmos bech32 address (litho1...) to its EVM 0x equivalent.
 * Ethermint accounts share the same 20-byte payload between the bech32 and 0x
 * encodings, so `eth_getBalance` on the derived 0x address returns the account's
 * native (unified bank) balance. Returns undefined for non-litho1 or non-20-byte
 * addresses (e.g. 32-byte module accounts), which have no EVM holder balance.
 * Mirrors the API's `cosmosToEvm` in api/src/routes.ts.
 */
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

/** EVM 0x form for any account address (pass-through for 0x, bech32-derived otherwise). */
function deriveEvmAddress(address: string): string | undefined {
  return address.startsWith('0x') ? address.toLowerCase() : cosmosToEvm(address);
}

async function upsertAccount(client: DbClient, address: string, height: number): Promise<void> {
  if (!address || address.length < 5) return;
  // Populate evm_address so the native-balance sweep (refreshNativeBalances) can
  // include this account. Cosmos events emit litho1 bech32 addresses; without the
  // derived 0x form the sweep's `WHERE evm_address IS NOT NULL` skipped every
  // non-genesis account, pinning the native holder count at the genesis count.
  const evmAddress = deriveEvmAddress(address) ?? null;
  await client.query(
    `INSERT INTO accounts (address, evm_address, first_seen_block, last_seen_block, updated_at)
     VALUES ($1, $2, $3, $3, NOW())
     ON CONFLICT (address) DO UPDATE SET
       evm_address = COALESCE(NULLIF(accounts.evm_address, ''), EXCLUDED.evm_address),
       last_seen_block = GREATEST(accounts.last_seen_block, EXCLUDED.last_seen_block),
       updated_at = NOW()`,
    [address, evmAddress, height]
  );
}

// ─── Validator Refresh ────────────────────────────────────────────────────────

async function refreshValidators(): Promise<void> {
  try {
    const [validatorResponse, signingResponse, slashingParamsResponse] = await Promise.all([
      fetch(`${LCD_URL}/cosmos/staking/v1beta1/validators?pagination.limit=200`, {
        signal: AbortSignal.timeout(15_000),
      }),
      fetch(`${LCD_URL}/cosmos/slashing/v1beta1/signing_infos?pagination.limit=200`, {
        signal: AbortSignal.timeout(15_000),
      }).catch(() => null),
      fetch(`${LCD_URL}/cosmos/slashing/v1beta1/params`, {
        signal: AbortSignal.timeout(15_000),
      }).catch(() => null),
    ]);
    if (!validatorResponse.ok) {
      logger.warn({ status: validatorResponse.status }, '[validators] LCD non-OK');
      return;
    }

    const data = await validatorResponse.json() as {
      validators?: Array<{
        operator_address: string;
        consensus_pubkey: unknown;
        description: { moniker: string; identity: string; website: string; security_contact: string; details: string };
        commission: { commission_rates: { rate: string; max_rate: string; max_change_rate: string } };
        min_self_delegation: string;
        tokens: string;
        delegator_shares: string;
        status: string;
        jailed: boolean;
      }>;
    };
    const signingData = signingResponse?.ok
      ? await signingResponse.json() as { info?: SigningInfo[] }
      : { info: [] };
    const slashingParams = slashingParamsResponse?.ok
      ? await slashingParamsResponse.json() as { params?: { signed_blocks_window?: string } }
      : {};
    const signingWindow = slashingParams.params?.signed_blocks_window;
    const signingByAddress = signingInfoByAddress(signingData.info ?? []);

    const statusCode: Record<string, number> = {
      BOND_STATUS_BONDED: 3,
      BOND_STATUS_UNBONDING: 2,
      BOND_STATUS_UNBONDED: 1,
    };

    for (const v of data.validators ?? []) {
      const d = v.description ?? {};
      const c = v.commission?.commission_rates ?? {};
      const consensusAddress = consensusAddressFromPublicKey(v.consensus_pubkey);
      const signingInfo = consensusAddress
        ? signingByAddress.get(consensusAddress.toLowerCase())
        : undefined;
      const uptime = signingInfo
        ? signingUptime(signingInfo.missed_blocks_counter, signingWindow, signingInfo.index_offset)
        : null;
      await pool.query(
        `INSERT INTO validators
           (operator_address, consensus_address, consensus_pubkey, moniker, identity, website,
            security_contact, details, commission_rate, commission_max_rate,
            commission_max_change, min_self_delegation, tokens, delegator_shares,
            status, jailed, uptime_percentage, missed_blocks_counter, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,NOW())
         ON CONFLICT (operator_address) DO UPDATE SET
           consensus_address = COALESCE(EXCLUDED.consensus_address, validators.consensus_address),
           consensus_pubkey   = EXCLUDED.consensus_pubkey,
           tokens            = EXCLUDED.tokens,
           delegator_shares  = EXCLUDED.delegator_shares,
           status            = EXCLUDED.status,
           jailed            = EXCLUDED.jailed,
           moniker           = EXCLUDED.moniker,
           identity          = EXCLUDED.identity,
           website           = EXCLUDED.website,
           security_contact  = EXCLUDED.security_contact,
           details           = EXCLUDED.details,
           commission_rate   = EXCLUDED.commission_rate,
           commission_max_rate = EXCLUDED.commission_max_rate,
           commission_max_change = EXCLUDED.commission_max_change,
           min_self_delegation = EXCLUDED.min_self_delegation,
           uptime_percentage = COALESCE(EXCLUDED.uptime_percentage, validators.uptime_percentage),
           missed_blocks_counter = COALESCE(EXCLUDED.missed_blocks_counter, validators.missed_blocks_counter),
           updated_at        = NOW()`,
        [
          v.operator_address,
          consensusAddress,
          JSON.stringify(v.consensus_pubkey),
          d.moniker ?? '', d.identity ?? '', d.website ?? '',
          d.security_contact ?? '', d.details ?? '',
          c.rate ?? '0', c.max_rate ?? '0', c.max_change_rate ?? '0',
          v.min_self_delegation ?? '0',
          v.tokens ?? '0', v.delegator_shares ?? '0',
          statusCode[v.status] ?? 1,
          v.jailed ?? false,
          uptime,
          signingInfo?.missed_blocks_counter ?? null,
        ]
      );
    }
    logger.info({ count: data.validators?.length ?? 0 }, '[validators] Refreshed validators');
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, '[validators] refresh failed');
  }
}

// ─── Network Stats ────────────────────────────────────────────────────────────

async function recordNetworkStats(): Promise<void> {
  try {
    const [tx, acc, ct] = await Promise.all([
      pool.query<{ count: string }>('SELECT COUNT(*) count FROM transactions'),
      pool.query<{ count: string }>('SELECT COUNT(*) count FROM accounts'),
      pool.query<{ count: string }>('SELECT COUNT(*) count FROM contracts'),
    ]);
    await pool.query(
      `INSERT INTO network_stats (total_transactions, total_accounts, total_contracts)
       VALUES ($1, $2, $3)`,
      [parseInt(tx.rows[0].count), parseInt(acc.rows[0].count), parseInt(ct.rows[0].count)]
    );
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, '[stats] refresh failed');
  }
}

// ─── Native Balance Refresh ─────────────────────────────────────────────────────
//
// Current native LITHO balances cannot be derived from indexed events: native
// value moves via gas fees, staking, rewards and bank sends that are not all
// captured as Transfer logs. The live chain is the only source of truth. We keep
// `accounts.balance` warm with a bounded, rolling `eth_getBalance` sweep so that
// "current holder" counts (accounts WHERE balance <> '0') reflect real owners
// instead of the historical-participant overcount (every address ever seen).
//
// Bounded: NATIVE_BALANCE_BATCH accounts per pass, ordered stalest-checked first
// (balance_block ASC) then most-recently-active (last_seen_block DESC), so
// never-checked and hot accounts converge first and coverage rotates over time.
// Accounts without a known EVM address are skipped — their balance stays at the
// default 0 and they count as non-holders, which under-counts rather than
// over-counts. RPC misses leave balance_block untouched so they retry next pass.
const NATIVE_BALANCE_BATCH = Number(process.env.NATIVE_BALANCE_BATCH || 250);

async function refreshNativeBalances(chainTip: number): Promise<void> {
  if (EVM_RPC_ENDPOINTS.length === 0 || chainTip <= 0) return;
  try {
    // Sweep ALL accounts (stalest balance_block first), not only those that
    // already have an evm_address. Older rows were inserted with evm_address=NULL
    // (upsertAccount didn't derive it), so the previous `WHERE evm_address IS NOT
    // NULL` filter excluded every non-genesis account — the native holder count
    // never grew past the genesis seed. We now derive the 0x form on the fly and
    // backfill it as we go.
    const candidates = await pool.query<{ address: string; evm_address: string | null }>(
      `SELECT address, evm_address
         FROM accounts
        ORDER BY balance_block ASC, last_seen_block DESC NULLS LAST
        LIMIT $1`,
      [NATIVE_BALANCE_BATCH]
    );
    if (candidates.rows.length === 0) return;

    let refreshed = 0;
    let nonzero = 0;
    let skipped = 0;
    for (const acc of candidates.rows) {
      const evm = (acc.evm_address && acc.evm_address.startsWith('0x'))
        ? acc.evm_address
        : deriveEvmAddress(acc.address);
      if (!evm) {
        // No EVM form (e.g. 32-byte module account) — it can't hold a native
        // holder balance. Advance balance_block so it isn't reselected every pass
        // (otherwise the stalest-first ordering would loop on it forever).
        await pool.query(
          `UPDATE accounts SET balance_block = $1 WHERE address = $2`,
          [chainTip, acc.address]
        );
        skipped++;
        continue;
      }
      const hex = await evmRpc<string>('eth_getBalance', [evm, 'latest']);
      if (hex == null) continue; // RPC miss — leave balance + balance_block as-is so it retries next pass
      let bal: string;
      try { bal = BigInt(hex).toString(); } catch { continue; }
      await pool.query(
        `UPDATE accounts
            SET balance = $1,
                balance_block = $2,
                evm_address = COALESCE(NULLIF(evm_address, ''), $3),
                updated_at = NOW()
          WHERE address = $4`,
        [bal, chainTip, evm, acc.address]
      );
      refreshed++;
      if (bal !== '0') nonzero++;
    }
    if (refreshed > 0 || skipped > 0) {
      logger.info({ refreshed, nonzero, skipped, batch: candidates.rows.length }, '[balances] native balance sweep');
    }
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, '[balances] refresh failed');
  }
}

// ─── HTTP Servers ─────────────────────────────────────────────────────────────
//
// Bound BEFORE the DB wait + bootstrap so /version and /health are reachable
// the moment Node starts the process. Phase 4's post-deploy SHA verification
// curls /version with a tight timeout; if the indexer is still waiting on
// Postgres when the curl fires, it gets "unknown" and the verification table
// reports a spurious mismatch.
//
// Resolvers reference module-scope state (BUILD_INFO, PROCESS_START,
// syncSnapshot — all initialised at import time with safe defaults), so the
// handlers stay responsive even before main() runs. /debug invokes
// refreshSyncSnapshot() which needs the pool; if the pool isn't ready, the
// handler returns 500 (gated by try/catch) — acceptable, since /debug is
// only meaningful once indexing is live.

function startHealthServer(): void {
  const app = express();
  app.get('/health', (_, res) =>
    res.json({
      status: 'healthy',
      service: 'lithosphere-indexer',
      timestamp: new Date().toISOString(),
      version: BUILD_INFO.version,
      sync: syncSnapshot,
    })
  );
  app.get('/version', (_, res) =>
    res.json(buildVersionResponse('lithosphere-indexer', PROCESS_START, BUILD_INFO))
  );
  app.get('/debug', async (_, res) => {
    try {
      const snapshot = await refreshSyncSnapshot();
      res.json({
        status: 'ok',
        service: 'lithosphere-indexer',
        timestamp: new Date().toISOString(),
        sync: snapshot,
      });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });
  app.listen(process.env.INDEXER_PORT ?? 3001, () => logger.info({ port: 3001, build: BUILD_INFO }, 'indexer_health_listening'));

  const metricsApp = express();
  metricsApp.get('/metrics', async (_, res) => {
    res.set('Content-Type', register.contentType);
    res.end(await register.metrics());
  });
  metricsApp.listen(process.env.METRICS_PORT ?? 9090, () => logger.info({ port: 9090 }, 'indexer_metrics_listening'));
}

// ─── Performance index migration ───────────────────────────────────────────────

// Source of truth: infra/postgres/performance-indexes.sql. Kept in sync here so
// existing prod databases (created before these indexes landed in init.sql) get
// them applied at indexer startup. The first index fixes the /txs full-table sort.
const PERFORMANCE_INDEXES: string[] = [
  'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tx_time_height ON transactions(timestamp DESC, block_height DESC)',
  'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_evm_tx_cosmos_hash ON evm_transactions(cosmos_tx_hash)',
  'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_blocks_time ON blocks(block_time DESC)',
  'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_blocks_proposer ON blocks(proposer_address)',
  'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tx_block_index ON transactions(block_height, tx_index)',
  'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tx_sender_lower ON transactions(LOWER(sender))',
  'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tx_receiver_lower ON transactions(LOWER(receiver))',
  'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_evm_tx_hash_lower ON evm_transactions(LOWER(hash))',
  'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_evm_tx_cosmos_hash_lower ON evm_transactions(LOWER(cosmos_tx_hash))',
  'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_evm_tx_from_lower ON evm_transactions(LOWER(from_address))',
  'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_evm_tx_to_lower ON evm_transactions(LOWER(to_address))',
  'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_evm_tx_contract_lower ON evm_transactions(LOWER(contract_address))',
  'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_accounts_address_lower ON accounts(LOWER(address))',
  'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_accounts_evm_lower ON accounts(LOWER(evm_address))',
  // Current-holder count: COUNT(*) FROM accounts WHERE balance <> '0'. Partial
  // index so the count touches only the (small) set of actual holders.
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_accounts_nonzero_balance ON accounts(address) WHERE balance IS NOT NULL AND balance <> '0'`,
  // Balance-sweep candidate selection: ORDER BY balance_block ASC, last_seen_block DESC.
  'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_accounts_balance_sweep ON accounts(balance_block ASC, last_seen_block DESC)',
  'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_transfers_tx_lower ON token_transfers(LOWER(tx_hash))',
  'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_transfers_contract_lower ON token_transfers(LOWER(contract_address))',
  'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_transfers_from_lower ON token_transfers(LOWER(from_address))',
  'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_transfers_to_lower ON token_transfers(LOWER(to_address))',
  'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_contracts_address_lower ON contracts(LOWER(address))',
];

async function ensurePerformanceIndexes(): Promise<void> {
  for (const sql of PERFORMANCE_INDEXES) {
    // Each statement runs on its own (autocommit) connection: CREATE INDEX
    // CONCURRENTLY cannot run inside a transaction block.
    try {
      await pool.query(sql);
      logger.info({ sql }, '[migration] performance index ensured');
    } catch (err) {
      // A failed CONCURRENTLY build can leave an INVALID index that IF NOT EXISTS
      // will skip — log clearly so it can be dropped/rebuilt manually if needed.
      logger.warn({ sql, err: err instanceof Error ? err.message : String(err) }, '[migration] performance index failed');
    }
  }
  logger.info('[migration] performance index migration complete');
}

// ─── Main Loop ────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  logger.info(
    { rpc: RPC_URL, lcd: LCD_URL, evmRpc: EVM_RPC_ENDPOINTS.join(', ') || '(disabled)', start: START_BLOCK, batch: BATCH_SIZE },
    '[indexer] booting',
  );

  // Bind the health + version + metrics servers FIRST. Anything that comes
  // after — DB wait, schema introspection, EVM backfill — could take minutes
  // and used to leave /version 404-ing through that whole window.
  startHealthServer();

  // Wait for PostgreSQL
  for (let i = 1; i <= 15; i++) {
    try { await pool.query('SELECT 1'); logger.info('[indexer] DB connected'); break; }
    catch { logger.info({ attempt: i }, '[indexer] Waiting for DB'); await new Promise(r => setTimeout(r, 3000)); }
  }

  // Log database schema for diagnostics
  try {
    const tables = ['blocks', 'transactions', 'evm_transactions', 'accounts', 'indexer_state'];
    for (const t of tables) {
      const cols = await pool.query(
        `SELECT column_name, data_type, character_maximum_length FROM information_schema.columns WHERE table_name = $1 ORDER BY ordinal_position`,
        [t]
      );
      if (cols.rows.length > 0) {
        const cols_str = cols.rows.map((c: Record<string, unknown>) => `${c.column_name}(${c.data_type}${c.character_maximum_length ? ':' + c.character_maximum_length : ''})`).join(', ');
        logger.info({ table: t, columns: cols_str }, '[schema]');
      } else {
        logger.warn({ table: t }, '[schema] Table NOT FOUND in database');
      }
    }
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, '[schema] Could not inspect schema');
  }

  // Ensure indexer_state table exists (RDS may have been created by another indexer)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS indexer_state (
      key VARCHAR(100) PRIMARY KEY,
      value TEXT,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `);
  await pool.query(`
    INSERT INTO indexer_state (key, value) VALUES
      ('last_indexed_block', '0'),
      ('last_indexed_evm_block', '0')
    ON CONFLICT (key) DO NOTHING
  `);

  // Runtime migration: token_transfers unique constraint (idempotent re-indexing guard).
  // New DBs get this from init.sql; existing prod DBs may be missing it.
  try {
    await pool.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'token_transfers_tx_log_unique'
        ) THEN
          ALTER TABLE token_transfers
          ADD CONSTRAINT token_transfers_tx_log_unique UNIQUE (tx_hash, log_index);
        END IF;
      END$$;
    `);
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, '[migration] token_transfers unique constraint failed');
  }

  // Runtime migration: native-balance refresh marker. The balance sweep
  // (refreshNativeBalances) keeps accounts.balance warm via eth_getBalance and
  // records the chain height it was last checked at, so the rolling sweep can
  // rotate fairly (stalest-checked accounts first). Must run BEFORE
  // ensurePerformanceIndexes() below, which builds an index over this column.
  try {
    await pool.query(`ALTER TABLE accounts ADD COLUMN IF NOT EXISTS balance_block BIGINT NOT NULL DEFAULT 0`);
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, '[migration] accounts.balance_block failed');
  }

  // Runtime migration: performance indexes (mirror of infra/postgres/performance-indexes.sql).
  // New DBs get these from init.sql, but Postgres only runs init scripts on an empty data dir,
  // so existing prod volumes (millions of rows) are missing them — leaving /txs to do a full
  // table sort on every request (~9s). CREATE INDEX CONCURRENTLY avoids locking the table
  // against this indexer's continuous writes; IF NOT EXISTS makes it a fast no-op once built.
  // Fired non-blocking so block catch-up proceeds while the (one-time) builds run in background.
  // NOTE: this pool has no statement_timeout — required, as these builds can take minutes.
  void ensurePerformanceIndexes();

  const shouldForceReset = process.env.FORCE_REINDEX === '1' || process.env.FORCE_REINDEX === 'true';
  await ensureChainConsistency(shouldForceReset);
  await seedStaticData();
  await refreshSyncSnapshot();
  await repairInconsistentBlocks();
  await refreshSyncSnapshot();

  // Targeted EVM backfill: re-process only blocks that have transactions but no EVM records.
  // This avoids resetting to 0 and re-processing all 85k+ blocks on every restart.
  try {
    const evmCount = await pool.query('SELECT COUNT(*) AS count FROM evm_transactions');
    const evmTotal = parseInt(evmCount.rows[0]?.count ?? '0');
    if (evmTotal === 0) {
      const txBlocks = await pool.query(
        `SELECT DISTINCT block_height FROM transactions ORDER BY block_height`
      );
      if (txBlocks.rows.length > 0) {
        logger.info({ count: txBlocks.rows.length }, '[indexer] EVM backfill: re-processing blocks with transactions');
        for (const row of txBlocks.rows) {
          const h = parseInt(row.block_height);
          try {
            await indexBlock(h);
            await setLastIndexedEvmBlock(h);
            logger.info({ height: h }, '[indexer] EVM backfill: re-processed block');
          } catch (err) {
            logger.warn({ height: h, err: err instanceof Error ? err.message : String(err) }, '[indexer] EVM backfill block failed');
          }
        }
        const evmAfter = await pool.query('SELECT COUNT(*) AS count FROM evm_transactions');
        logger.info({ evmTxs: evmAfter.rows[0]?.count ?? 0 }, '[indexer] EVM backfill complete');
      }
    }
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, '[indexer] EVM backfill check failed');
  }

  // Token Transfer backfill: scan historical EVM logs for Transfer events.
  // Runs once per DB (tracked via indexer_state). Needed when Transfer-log
  // indexing is rolled out on top of a DB that was already indexed.
  try {
    await backfillTokenTransfers();
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, '[indexer] Token transfer backfill failed');
  }

  // NFT classification backfill: tag collections whose ERC-721 transfers were
  // indexed before contract_type='nft' tagging existed.
  try {
    await backfillNftContractTypes();
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, '[indexer] NFT contract classification backfill failed');
  }

  // Initial validator load
  await refreshValidators();

  let lastValidatorRefresh = Date.now();
  let lastStatsRefresh     = Date.now();
  let lastConsistencyRepair = Date.now();
  let lastSyncSnapshotRefresh = Date.now();
  let lastNativeBalanceRefresh = 0; // 0 → run on the first cycle so holder counts warm up immediately

  while (true) {
    const cycleId = newCycleId();
    await cycleIdStore.run({ cycleId }, async () => {
    try {
      const status = await rpcGet<RpcStatus>('/status');
      const chainTip = parseInt(status.sync_info.latest_block_height);
      lastKnownChainTip = chainTip;
      gChain.set(chainTip);

      let from = await getLastIndexedBlock();
      if (from < START_BLOCK - 1) from = START_BLOCK - 1;
      const to = Math.min(from + BATCH_SIZE, chainTip);
      gLag.set(Math.max(0, chainTip - from));

      if (from >= chainTip) {
        if (Date.now() - lastSyncSnapshotRefresh > SYNC_SNAPSHOT_REFRESH_MS) {
          await refreshSyncSnapshot(chainTip);
          lastSyncSnapshotRefresh = Date.now();
        }
        // Fully caught up — wait for next block
        await new Promise(r => setTimeout(r, POLL_MS));
        return;
      }

      const lag = chainTip - from;
      logger.info({ from: from + 1, to, lag }, 'cycle_sync_range');

      for (let h = from + 1; h <= to; h++) {
        await indexBlock(h);
        await setLastIndexedBlock(h);
        await setLastIndexedEvmBlock(h);
        gLag.set(Math.max(0, chainTip - h));
      }

      // Periodic maintenance
      if (Date.now() - lastValidatorRefresh > 600_000) {
        await refreshValidators();
        lastValidatorRefresh = Date.now();
      }
      if (Date.now() - lastStatsRefresh > 300_000) {
        await recordNetworkStats();
        lastStatsRefresh = Date.now();
      }
      if (Date.now() - lastNativeBalanceRefresh > 60_000) {
        await refreshNativeBalances(lastKnownChainTip);
        lastNativeBalanceRefresh = Date.now();
      }
      if (Date.now() - lastConsistencyRepair > CONSISTENCY_REPAIR_INTERVAL_MS) {
        await repairInconsistentBlocks();
        lastConsistencyRepair = Date.now();
      }
      if (Date.now() - lastSyncSnapshotRefresh > SYNC_SNAPSHOT_REFRESH_MS || to >= chainTip) {
        await refreshSyncSnapshot(chainTip);
        lastSyncSnapshotRefresh = Date.now();
      }

      // Back off only when caught up; aggressively sync when behind
      const delay = to >= chainTip ? POLL_MS : CATCHUP_DELAY_MS;
      await new Promise(r => setTimeout(r, delay));

    } catch (err) {
      logger.error({ err }, 'cycle_failed');
      await new Promise(r => setTimeout(r, 10_000));
    }
    });
  }
}

// Skip auto-start under Vitest — the test runner imports this module to
// exercise indexBlock() directly, and we don't want every test worker
// fighting for :3001 / :9090 (EADDRINUSE) or spinning up a polling loop.
if (!process.env.VITEST) {
  main().catch((err) => {
    logger.fatal({ err }, 'indexer_fatal');
    process.exit(1);
  });
}
