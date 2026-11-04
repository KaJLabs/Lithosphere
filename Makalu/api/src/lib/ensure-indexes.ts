import { Pool } from 'pg';
import { logger } from './logger.js';

// Performance indexes — source of truth: infra/postgres/performance-indexes.sql.
// New databases get these from init.sql, but Postgres only runs init scripts on an
// empty data dir, so existing prod volumes (millions of rows) are missing them —
// leaving /txs to do a full table sort on every request (~9s on ~4.9M rows). The
// first two entries fix the /txs sort + JOIN; the rest speed up address/token pages.
//
// This runs from the API (not only the indexer) because the live deploy pipeline
// (deploy-simple.yaml → vps1) recreates the web/api containers but NOT the indexer
// container, so an indexer-only migration never executes on the public host.
const PERFORMANCE_INDEXES: string[] = [
  'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tx_time_height ON transactions(timestamp DESC, block_height DESC)',
  'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_evm_tx_cosmos_hash ON evm_transactions(cosmos_tx_hash)',
  // blocks: idx_blocks_time fixes MAX(block_time) on /stats/summary (full scan
  // of ~6.6M blocks otherwise); idx_blocks_proposer powers the validator detail page.
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
  'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_transfers_tx_lower ON token_transfers(LOWER(tx_hash))',
  'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_transfers_contract_lower ON token_transfers(LOWER(contract_address))',
  'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_transfers_from_lower ON token_transfers(LOWER(from_address))',
  'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_transfers_to_lower ON token_transfers(LOWER(to_address))',
  'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_contracts_address_lower ON contracts(LOWER(address))',
];

/**
 * Build the performance indexes if they are missing. Idempotent and crash-safe:
 * CREATE INDEX CONCURRENTLY ... IF NOT EXISTS is a fast no-op once the index
 * exists, so only the first run after a fresh DB pays the (one-time) build cost.
 *
 * Uses its OWN pool with no statement_timeout — the shared db.ts pool sets a 15s
 * statement_timeout that would kill a multi-minute CONCURRENTLY build on a large
 * table. CONCURRENTLY also cannot run inside a transaction block, so each index
 * is issued as a standalone (autocommit) query.
 */
export async function ensurePerformanceIndexes(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    logger.warn('[migration] DATABASE_URL not set — skipping performance index migration');
    return;
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 2,
    // Deliberately NO statement_timeout / query_timeout — index builds can take
    // minutes on large tables and must not be interrupted.
    statement_timeout: 0,
    ssl: process.env.DATABASE_URL?.includes('sslmode=disable')
      ? false
      : { rejectUnauthorized: false },
  });
  pool.on('error', (err) => logger.error({ err: err.message }, '[migration] index pool error'));

  try {
    await pool.query('ALTER TABLE contracts ADD COLUMN IF NOT EXISTS deployer_verified_at TIMESTAMPTZ');
    for (const sql of PERFORMANCE_INDEXES) {
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
  } finally {
    await pool.end().catch(() => {});
  }
}
