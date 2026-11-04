import type { PoolClient } from 'pg';

type QueryClient = Pick<PoolClient, 'query'>;
const fields = ['hash', 'block_height', 'tx_index', 'tx_type', 'sender', 'receiver', 'amount', 'denom',
  'gas_used', 'gas_wanted', 'fee', 'fee_denom', 'success', 'memo', 'raw_log', 'timestamp'];
const columns = fields.join(', ');
const parameters = fields.map((_, index) => '$' + (index + 1)).join(', ');
const updates = fields.slice(1).map(field => `${field} = EXCLUDED.${field}`).join(', ');

export const TRANSACTION_INCLUSION_SCHEMA = `
CREATE TABLE IF NOT EXISTS transaction_inclusions (
  chain_id TEXT NOT NULL,
  hash VARCHAR(64) NOT NULL,
  block_height BIGINT NOT NULL CHECK (block_height > 0),
  tx_index INTEGER NOT NULL CHECK (tx_index >= 0),
  tx_type VARCHAR(50), sender VARCHAR(100), receiver VARCHAR(100), amount VARCHAR(78), denom VARCHAR(50),
  gas_used BIGINT, gas_wanted BIGINT, fee VARCHAR(78), fee_denom VARCHAR(50), success BOOLEAN NOT NULL,
  memo TEXT, raw_log TEXT, timestamp TIMESTAMPTZ NOT NULL, abci_code INTEGER,
  PRIMARY KEY (chain_id, block_height, tx_index)
);
CREATE INDEX IF NOT EXISTS idx_inclusion_hash ON transaction_inclusions(chain_id, hash, block_height);
CREATE INDEX IF NOT EXISTS idx_inclusion_height ON transaction_inclusions(block_height, tx_index);
`;

/** Additive backfill; run explicitly while the production writer is stopped. */
export async function seedTransactionInclusions(client: QueryClient, chainId: string): Promise<number> {
  if (!chainId.trim()) throw new Error('Inclusion migration requires a verified chain ID');
  const invalid = await client.query('SELECT COUNT(*) AS count FROM transactions WHERE block_height IS NULL OR tx_index IS NULL');
  if (Number(invalid.rows[0].count) !== 0) throw new Error('Existing transaction positions require reconciliation');
  await client.query(TRANSACTION_INCLUSION_SCHEMA);
  const result = await client.query(
    `INSERT INTO transaction_inclusions (chain_id, ${columns})
     SELECT $1, ${columns} FROM transactions
     ON CONFLICT (chain_id, block_height, tx_index) DO NOTHING`, [chainId],
  );
  const missing = await client.query(`SELECT COUNT(*) AS count FROM transactions t
    LEFT JOIN transaction_inclusions i ON i.chain_id=$1 AND i.block_height=t.block_height AND i.tx_index=t.tx_index AND i.hash=t.hash
    WHERE i.hash IS NULL`, [chainId]);
  if (Number(missing.rows[0].count) !== 0) throw new Error('Inclusion backfill does not preserve all existing positions');
  await client.query(`INSERT INTO indexer_state (key,value,updated_at) VALUES ('transaction_inclusions_seeded',$1,NOW())
    ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value,updated_at=NOW()`, [chainId]);
  return result.rowCount ?? 0;
}

/** Both writes share the caller's block transaction. Existing UUIDs remain stable. */
export async function writeTransaction(client: QueryClient, values: unknown[], chainId?: string, executionCode?: number): Promise<void> {
  if (values.length !== fields.length) throw new Error('Invalid transaction field count');
  if (chainId) {
    // Preserve a legacy occurrence before updating its canonical record. This
    // also makes replay safe when a backfill and writer activation are separated.
    await client.query(`INSERT INTO transaction_inclusions (chain_id, ${columns})
      SELECT $1, ${columns} FROM transactions WHERE hash=$2
      ON CONFLICT (chain_id,block_height,tx_index) DO NOTHING`, [chainId, values[0]]);
  }
  await client.query(`INSERT INTO transactions (${columns}) VALUES (${parameters})
    ON CONFLICT (hash) DO UPDATE SET ${chainId ? updates : 'memo = EXCLUDED.memo'}
    ${chainId ? `WHERE (EXCLUDED.success IS TRUE AND transactions.success IS NOT TRUE)
      OR ((EXCLUDED.success IS TRUE) = (transactions.success IS TRUE)
        AND (EXCLUDED.block_height,EXCLUDED.tx_index) >= (transactions.block_height,transactions.tx_index))` : ''}`, values);
  if (chainId) {
    const result = await client.query(`INSERT INTO transaction_inclusions (chain_id, ${columns},abci_code)
      VALUES ($17, ${parameters},$18) ON CONFLICT (chain_id,block_height,tx_index)
      DO UPDATE SET ${fields.slice(3).map(field => `${field}=EXCLUDED.${field}`).join(', ')},abci_code=EXCLUDED.abci_code
      WHERE transaction_inclusions.hash=EXCLUDED.hash RETURNING hash`, [...values, chainId, executionCode ?? null]);
    if (result.rowCount !== 1) throw new Error('Conflicting transaction hash at an existing block position');
  }
}
