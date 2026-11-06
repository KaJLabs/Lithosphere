-- Candidate schema only; no live migration is performed by this change.
CREATE TABLE IF NOT EXISTS native_source_matches (
    deployment_id TEXT PRIMARY KEY,
    chain_id TEXT NOT NULL CHECK (chain_id ~ '^[1-9][0-9]*$'),
    contract_address TEXT NOT NULL CHECK (contract_address ~ '^0x[0-9a-f]{40}$'),
    block_hash TEXT NOT NULL CHECK (block_hash ~ '^0x[0-9a-f]{64}$'),
    block_height NUMERIC(20,0) NOT NULL CHECK (block_height > 0),
    evidence JSONB NOT NULL,
    canonical BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE INDEX IF NOT EXISTS native_source_matches_address
    ON native_source_matches (chain_id, contract_address, block_height DESC)
    WHERE canonical;
