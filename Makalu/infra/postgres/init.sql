-- ============================================================================
-- Lithosphere PostgreSQL Initialization Script
-- Canonical schema for LITHOSCAN Explorer & Indexer
-- ============================================================================
-- Source: Reconciled from validator-infra 001-schema.sql + Makalu schema
-- Compatible with: Ethermint dual-layer chain (Cosmos + EVM transactions)
-- ============================================================================

-- Enable extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- ============================================================================
-- BLOCKS TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS blocks (
    height BIGINT PRIMARY KEY,
    hash VARCHAR(64) NOT NULL UNIQUE,
    proposer_address VARCHAR(100),
    num_txs INTEGER DEFAULT 0,
    total_gas BIGINT DEFAULT 0,
    block_time TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_blocks_hash ON blocks(hash);
CREATE INDEX IF NOT EXISTS idx_blocks_proposer ON blocks(proposer_address);
CREATE INDEX IF NOT EXISTS idx_blocks_time ON blocks(block_time DESC);

-- ============================================================================
-- TRANSACTIONS TABLE (Cosmos-layer)
-- ============================================================================

CREATE TABLE IF NOT EXISTS transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    hash VARCHAR(64) NOT NULL UNIQUE,
    block_height BIGINT REFERENCES blocks(height),
    tx_index INTEGER,
    tx_type VARCHAR(50),
    sender VARCHAR(100),
    receiver VARCHAR(100),
    amount VARCHAR(78),
    denom VARCHAR(50),
    gas_used BIGINT,
    gas_wanted BIGINT,
    fee VARCHAR(78),
    fee_denom VARCHAR(50),
    success BOOLEAN DEFAULT TRUE,
    memo TEXT,
    raw_log TEXT,
    timestamp TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tx_hash ON transactions(hash);
CREATE INDEX IF NOT EXISTS idx_tx_block ON transactions(block_height);
CREATE INDEX IF NOT EXISTS idx_tx_sender ON transactions(sender);
CREATE INDEX IF NOT EXISTS idx_tx_receiver ON transactions(receiver);
CREATE INDEX IF NOT EXISTS idx_tx_timestamp ON transactions(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_tx_type ON transactions(tx_type);

-- ============================================================================
-- EVM TRANSACTIONS TABLE
-- Dual-layer: Ethermint wraps EVM txs inside Cosmos MsgEthereumTx messages
-- ============================================================================

CREATE TABLE IF NOT EXISTS evm_transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    hash VARCHAR(66) NOT NULL UNIQUE,
    cosmos_tx_hash VARCHAR(64) REFERENCES transactions(hash),
    block_height BIGINT,
    tx_index INTEGER,
    from_address VARCHAR(42) NOT NULL,
    to_address VARCHAR(42),
    value VARCHAR(78),
    gas_price VARCHAR(78),
    gas_limit BIGINT,
    gas_used BIGINT,
    nonce BIGINT,
    input_data TEXT,
    contract_address VARCHAR(42),
    status BOOLEAN DEFAULT TRUE,
    timestamp TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_evm_tx_hash ON evm_transactions(hash);
CREATE INDEX IF NOT EXISTS idx_evm_tx_from ON evm_transactions(from_address);
CREATE INDEX IF NOT EXISTS idx_evm_tx_to ON evm_transactions(to_address);
CREATE INDEX IF NOT EXISTS idx_evm_tx_contract ON evm_transactions(contract_address);
CREATE INDEX IF NOT EXISTS idx_evm_tx_block ON evm_transactions(block_height);

-- ============================================================================
-- ACCOUNTS TABLE
-- Stores both Cosmos (litho1...) and EVM (0x...) address formats.
-- The Lithosphere chain is Ethermint-based: same key bytes, two encodings.
-- ============================================================================

CREATE TABLE IF NOT EXISTS accounts (
    address VARCHAR(100) PRIMARY KEY,        -- Cosmos bech32 address (litho1...)
    evm_address VARCHAR(42),                 -- EVM hex address (0x...)
    balance VARCHAR(78) DEFAULT '0',
    sequence BIGINT DEFAULT 0,
    account_number BIGINT,
    pub_key TEXT,
    account_type VARCHAR(50),
    first_seen_block BIGINT,
    last_seen_block BIGINT,
    tx_count BIGINT DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_accounts_evm ON accounts(evm_address);
CREATE INDEX IF NOT EXISTS idx_accounts_balance ON accounts(balance);

-- ============================================================================
-- VALIDATORS TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS validators (
    operator_address VARCHAR(100) PRIMARY KEY,
    consensus_address VARCHAR(100) UNIQUE,
    consensus_pubkey TEXT,
    moniker VARCHAR(100),
    identity VARCHAR(50),
    website VARCHAR(255),
    security_contact VARCHAR(255),
    details TEXT,
    commission_rate VARCHAR(20),
    commission_max_rate VARCHAR(20),
    commission_max_change VARCHAR(20),
    min_self_delegation VARCHAR(78),
    tokens VARCHAR(78) DEFAULT '0',
    delegator_shares VARCHAR(78) DEFAULT '0',
    status INTEGER DEFAULT 0,
    jailed BOOLEAN DEFAULT FALSE,
    unbonding_height BIGINT,
    unbonding_time TIMESTAMP WITH TIME ZONE,
    uptime_percentage DECIMAL(5,2) DEFAULT 100.00,
    missed_blocks_counter BIGINT DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_validators_moniker ON validators(moniker);
CREATE INDEX IF NOT EXISTS idx_validators_status ON validators(status);
CREATE INDEX IF NOT EXISTS idx_validators_tokens ON validators(tokens);

-- ============================================================================
-- TOKEN TRANSFERS (LEP-100)
-- ============================================================================

CREATE TABLE IF NOT EXISTS token_transfers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tx_hash VARCHAR(66) NOT NULL,
    log_index INTEGER,
    contract_address VARCHAR(42) NOT NULL,
    from_address VARCHAR(42) NOT NULL,
    to_address VARCHAR(42) NOT NULL,
    value VARCHAR(78) NOT NULL,
    token_id VARCHAR(78),
    block_height BIGINT NOT NULL,
    timestamp TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_transfers_tx ON token_transfers(tx_hash);
CREATE INDEX IF NOT EXISTS idx_transfers_contract ON token_transfers(contract_address);
CREATE INDEX IF NOT EXISTS idx_transfers_from ON token_transfers(from_address);
CREATE INDEX IF NOT EXISTS idx_transfers_to ON token_transfers(to_address);
CREATE INDEX IF NOT EXISTS idx_transfers_block ON token_transfers(block_height);
-- Idempotency: prevent duplicate inserts when re-indexing the same tx/log pair
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'token_transfers_tx_log_unique'
    ) THEN
        ALTER TABLE token_transfers
        ADD CONSTRAINT token_transfers_tx_log_unique UNIQUE (tx_hash, log_index);
    END IF;
END$$;

-- ============================================================================
-- CONTRACTS TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS contracts (
    address VARCHAR(42) PRIMARY KEY,
    creator VARCHAR(42),
    creation_tx VARCHAR(66),
    creation_block BIGINT,
    bytecode TEXT,
    verified BOOLEAN DEFAULT FALSE,
    name VARCHAR(100),
    symbol VARCHAR(20),
    decimals INTEGER,
    total_supply VARCHAR(78),
    contract_type VARCHAR(50),
    source_code TEXT,
    abi JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_contracts_creator ON contracts(creator);
CREATE INDEX IF NOT EXISTS idx_contracts_type ON contracts(contract_type);

-- ============================================================================
-- PROPOSALS (GOVERNANCE)
-- ============================================================================

CREATE TABLE IF NOT EXISTS proposals (
    id BIGINT PRIMARY KEY,
    title VARCHAR(255),
    description TEXT,
    proposal_type VARCHAR(50),
    proposer VARCHAR(100),
    status VARCHAR(50),
    submit_time TIMESTAMP WITH TIME ZONE,
    deposit_end_time TIMESTAMP WITH TIME ZONE,
    voting_start_time TIMESTAMP WITH TIME ZONE,
    voting_end_time TIMESTAMP WITH TIME ZONE,
    total_deposit VARCHAR(78),
    yes_votes VARCHAR(78) DEFAULT '0',
    no_votes VARCHAR(78) DEFAULT '0',
    abstain_votes VARCHAR(78) DEFAULT '0',
    no_with_veto_votes VARCHAR(78) DEFAULT '0',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_proposals_status ON proposals(status);
CREATE INDEX IF NOT EXISTS idx_proposals_proposer ON proposals(proposer);

-- ============================================================================
-- INDEXER STATE
-- ============================================================================

CREATE TABLE IF NOT EXISTS indexer_state (
    key VARCHAR(100) PRIMARY KEY,
    value TEXT,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Initialize indexer state
INSERT INTO indexer_state (key, value) VALUES
    ('last_indexed_block', '0'),
    ('last_indexed_evm_block', '0'),
    ('indexer_version', '1.0.0')
ON CONFLICT (key) DO NOTHING;

-- ============================================================================
-- STATISTICS TABLE (for dashboard)
-- ============================================================================

CREATE TABLE IF NOT EXISTS network_stats (
    id SERIAL PRIMARY KEY,
    recorded_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    total_transactions BIGINT,
    total_accounts BIGINT,
    total_contracts BIGINT,
    avg_block_time DECIMAL(10,3),
    avg_gas_price VARCHAR(78),
    daily_transactions BIGINT,
    daily_active_accounts BIGINT
);

CREATE INDEX IF NOT EXISTS idx_stats_time ON network_stats(recorded_at DESC);

-- ============================================================================
-- FUNCTIONS
-- ============================================================================

-- Auto-increment account tx_count on transaction insert
CREATE OR REPLACE FUNCTION update_account_tx_count()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE accounts SET
        tx_count = tx_count + 1,
        last_seen_block = NEW.block_height,
        updated_at = NOW()
    WHERE address = NEW.sender OR address = NEW.receiver;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for transaction counts
DROP TRIGGER IF EXISTS tx_account_counter ON transactions;
CREATE TRIGGER tx_account_counter
    AFTER INSERT ON transactions
    FOR EACH ROW
    EXECUTE FUNCTION update_account_tx_count();

-- ============================================================================
-- Grant Permissions
-- ============================================================================
-- Grant permissions to known application users.
-- Dev: "lithosphere" (POSTGRES_USER in .env.local/.env.testnet)
-- Prod: "litho" / "lithoscan_admin" (RDS / .env.mainnet)
DO $$
DECLARE
    _role TEXT;
BEGIN
    FOREACH _role IN ARRAY ARRAY['lithosphere', 'litho', 'lithoscan_admin'] LOOP
        IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = _role) THEN
            EXECUTE format('GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO %I', _role);
            EXECUTE format('GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO %I', _role);
        END IF;
    END LOOP;
END
$$;

-- ============================================================================
-- GENESIS ACCOUNTS (from address_mapping_litho.csv — 15 genesis allocations)
-- ============================================================================
-- These are the initial token holders from the Lithosphere genesis block.
-- allocation is in whole LITHO (1 LITHO = 10^18 ulitho).

INSERT INTO accounts (address, evm_address, balance, sequence, account_number, account_type, first_seen_block, last_seen_block, tx_count)
VALUES
    ('litho1jqa20fhuxlceg7mwflpcxgfe4r2p2g2f0nrnj5', '0x903AA7a6fc37F1947B6e4fC3832139A8D4152149', '190000000000000000000000000', 0, 1, 'genesis', 1, 1, 0),
    ('litho1fe7hgzhc384dejgzlycyx9t80ere4vakcnphsm', '0x4E7d740Af889EADcC902F9304315677E479aB3b6', '190000000000000000000000000', 0, 2, 'genesis', 1, 1, 0),
    ('litho13qvmr0wdwun3rqq5qqahqxvzm8c3559pfwwwr0', '0x8819B1BdcD7727118014003b701982d9F11A50a1', '50000000000000000000000000', 0, 3, 'genesis', 1, 1, 0),
    ('litho1yzxrtd9uetfy5hmzzzqhq2sv2yteaafzes2e67', '0x208c35b4bCCAd24a5F621081702a0C51179Ef522', '50000000000000000000000000', 0, 4, 'genesis', 1, 1, 0),
    ('litho1v43usrfpru2t7caph9snajs7nf5j2ghuqwxyfc', '0x6563c80D211f14bf63a1B9613ECA1e9a692522Fc', '75000000000000000000000000', 0, 5, 'genesis', 1, 1, 0),
    ('litho17y8ecmw5p0e5kmvuq2q3m3t98hwz0r2t8su5ng', '0xF10f9C6Dd40bF34B6d9c02811dC5653dDc278D4b', '75000000000000000000000000', 0, 6, 'genesis', 1, 1, 0),
    ('litho12sdvp8mtl9elhec5mk630u3ge9t8hj5p383gu9', '0x541ac09f6bf973fbe714ddb517f228c9567bca81', '50000000000000000000000000', 0, 7, 'genesis', 1, 1, 0),
    ('litho1kuaqzyng4prjn7cp45qel58nqweajx7mx45ayp', '0xb73a011268a84729fb01ad019fd0f303b3d91bdb', '50000000000000000000000000', 0, 8, 'genesis', 1, 1, 0),
    ('litho13rf5cdrsrk073gl3npslv857ya7uufww5437lz', '0x88d34c34701d9fe8a3f19861f61e9e277dce25ce', '25000000000000000000000000', 0, 9, 'genesis', 1, 1, 0),
    ('litho1kaltpxap8ymlfcykekggpgt228zst3lly2t6mm', '0xb77eb09ba13937f4e096cd9080a16a51c505c7ff', '25000000000000000000000000', 0, 10, 'genesis', 1, 1, 0),
    ('litho1spzck5q8cymezjyaqw62g8s6hjfsg8cxqsrvww', '0x80458b5007c13791489d03b4a41e1abc93041f06', '35000000000000000000000000', 0, 11, 'genesis', 1, 1, 0),
    ('litho1h4cl2cxaxzzfxw7qgamn2zuj7cfwjwts6w6rkw', '0xbd71f560dd3084933bc04777350b92f612e93970', '35000000000000000000000000', 0, 12, 'genesis', 1, 1, 0),
    ('litho14c3y86hfd69kwqmdkup9y90ertu53cu6ewpr7h', '0xae2243eae96e8b67036db7025215f91af948e39a', '40000000000000000000000000', 0, 13, 'genesis', 1, 1, 0),
    ('litho1g5vc8rcxla03p2456gsfayevpwt44yhxm72naj', '0x4519838f06ff5f10aab4d2209e932c0b975a92e6', '40000000000000000000000000', 0, 14, 'genesis', 1, 1, 0),
    ('litho187m5cwfthxyspdzrpqvzs9c6f6k5gzenw8lkq2', '0x3fb74c392BB98900b443081828171a4Ead440B33', '70000000000000000000000000', 0, 15, 'genesis', 1, 1, 0)
ON CONFLICT (address) DO NOTHING;

-- ============================================================================
-- LEP100 TOKENS (10 deployed tokens on Lithosphere Makalu)
-- ============================================================================

INSERT INTO contracts (address, name, symbol, decimals, total_supply, contract_type)
VALUES
  ('0xEB6cfcC84F35D6b20166cD6149Fed712ED2a7Cfe', 'Wrapped Lithosphere', 'wLITHO', 18, '1000000000000000000000000000', 'token'),
  ('0x468022F17CAFEBD43C18f68D53c66a1a7f0E5249', 'Lithosphere LitBTC', 'LitBTC', 8, '21000000000000000', 'token'),
  ('0x9611436ea7B4764Eeb1E31B83A5bF03c835Eb3e8', 'Lithosphere Algo', 'LAX', 6, '10000000000000000', 'token'),
  ('0x8187b232BDa461d17EA519Ba6898F7b220AAf2e2', 'Jot Art', 'JOT', 18, '1000000000000000000000000000', 'token'),
  ('0xE7eBf52bD714348984Fb00b4c99d9e994D60DF49', 'Colle AI', 'COLLE', 18, '5000000000000000000000000000', 'token'),
  ('0x7a29252B13367800dD78FED47afFaB86a615c844', 'Imagen Network', 'IMAGE', 18, '10000000000000000000000000000', 'token'),
  ('0x9984ad7a774218B263D74BD8A5FFEDa7DD6Fe020', 'AGII', 'AGII', 18, '1000000000000000000000000000', 'token'),
  ('0x07039884740F4DB0f71BD3bCF87a3FfA0B85A26F', 'Built AI', 'BLDR', 18, '1000000000000000000000000000', 'token'),
  ('0xa25c2a49893B0296977E2E70Da56AF47241d592F', 'FurGPT', 'FGPT', 18, '1000000000000000000000000000', 'token'),
  ('0xDEE12eD9C5A1F7c29f3ab3961B892a8434A97EFa', 'Mansa AI', 'MUSA', 18, '1000000000000000000000000000', 'token')
ON CONFLICT (address) DO NOTHING;

-- Log initialization
DO $$
BEGIN
    RAISE NOTICE 'LITHOSCAN database initialized successfully at %', NOW();
    RAISE NOTICE 'Genesis accounts seeded: 15 accounts from address_mapping_litho.csv';
    RAISE NOTICE 'LEP100 tokens seeded: 10 tokens (wLITHO, LitBTC, LAX, JOT, COLLE, IMAGE, AGII, BLDR, FGPT, MUSA)';
END
$$;
