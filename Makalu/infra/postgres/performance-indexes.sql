-- Apply this on existing explorer databases to speed up high-volume transaction queries.
-- Safe to run multiple times.

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_blocks_time ON blocks(block_time DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_blocks_proposer ON blocks(proposer_address);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tx_block_index ON transactions(block_height, tx_index);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tx_time_height ON transactions(timestamp DESC, block_height DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tx_sender_lower ON transactions(LOWER(sender));
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tx_receiver_lower ON transactions(LOWER(receiver));

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_evm_tx_hash_lower ON evm_transactions(LOWER(hash));
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_evm_tx_cosmos_hash ON evm_transactions(cosmos_tx_hash);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_evm_tx_cosmos_hash_lower ON evm_transactions(LOWER(cosmos_tx_hash));
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_evm_tx_from_lower ON evm_transactions(LOWER(from_address));
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_evm_tx_to_lower ON evm_transactions(LOWER(to_address));
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_evm_tx_contract_lower ON evm_transactions(LOWER(contract_address));

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_accounts_address_lower ON accounts(LOWER(address));
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_accounts_evm_lower ON accounts(LOWER(evm_address));

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_transfers_tx_lower ON token_transfers(LOWER(tx_hash));
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_transfers_contract_lower ON token_transfers(LOWER(contract_address));
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_transfers_from_lower ON token_transfers(LOWER(from_address));
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_transfers_to_lower ON token_transfers(LOWER(to_address));

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_contracts_address_lower ON contracts(LOWER(address));

-- Address transaction list: newest-first per address with the hash included, so
-- /address/:address/txs pages and counts are index-only scans.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tx_sender_lower_ts ON transactions (LOWER(sender), "timestamp" DESC) INCLUDE (hash);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tx_receiver_lower_ts ON transactions (LOWER(receiver), "timestamp" DESC) INCLUDE (hash);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_evm_tx_from_lower_ts ON evm_transactions (LOWER(from_address), "timestamp" DESC) INCLUDE (cosmos_tx_hash);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_evm_tx_to_lower_ts ON evm_transactions (LOWER(to_address), "timestamp" DESC) INCLUDE (cosmos_tx_hash);
