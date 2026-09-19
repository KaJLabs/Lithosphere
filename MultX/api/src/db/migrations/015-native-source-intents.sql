CREATE TABLE native_source_intents (
 swap_id TEXT PRIMARY KEY REFERENCES native_swaps(swap_id),
 plan JSONB NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE native_source_transactions (
 swap_id TEXT NOT NULL REFERENCES native_source_intents(swap_id),
 step INTEGER NOT NULL CHECK(step BETWEEN 0 AND 2),
 chain_id BIGINT NOT NULL CHECK(chain_id>0),
 sender TEXT NOT NULL,
 nonce BIGINT NOT NULL CHECK(nonce>=0),
 transaction_hash TEXT NOT NULL CHECK(transaction_hash ~ '^0x[0-9a-f]{64}$'),
 PRIMARY KEY(swap_id,step),
 UNIQUE(chain_id,transaction_hash),
 UNIQUE(chain_id,sender,nonce)
);
CREATE FUNCTION protect_native_source_intent() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'source intent and transaction bindings are immutable'; END $$;
CREATE TRIGGER native_source_intent_guard BEFORE UPDATE OR DELETE ON native_source_intents
 FOR EACH ROW EXECUTE FUNCTION protect_native_source_intent();
CREATE TRIGGER native_source_transaction_guard BEFORE UPDATE OR DELETE ON native_source_transactions
 FOR EACH ROW EXECUTE FUNCTION protect_native_source_intent();
