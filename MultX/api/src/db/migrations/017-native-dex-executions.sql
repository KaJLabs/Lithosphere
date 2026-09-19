CREATE TABLE native_dex_executions (
 swap_id TEXT PRIMARY KEY REFERENCES native_swaps(swap_id),
 policy_id TEXT NOT NULL REFERENCES native_route_policies(policy_id),
 chain_id BIGINT NOT NULL,
 sender TEXT NOT NULL,
 plan JSONB NOT NULL,
 transaction_hash TEXT,
 nonce BIGINT,
 evidence JSONB,
 UNIQUE(chain_id,transaction_hash),
 UNIQUE(chain_id,sender,nonce),
 CHECK((transaction_hash IS NULL)=(nonce IS NULL)),
 CHECK(transaction_hash IS NULL OR transaction_hash ~ '^0x[0-9a-f]{64}$'),
 CHECK(nonce IS NULL OR nonce>=0),
 CHECK(evidence IS NULL OR transaction_hash IS NOT NULL)
);
CREATE FUNCTION protect_native_dex_execution() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'DEX execution cannot be deleted'; END IF;
 IF ROW(NEW.swap_id,NEW.policy_id,NEW.chain_id,NEW.sender,NEW.plan) IS DISTINCT FROM ROW(OLD.swap_id,OLD.policy_id,OLD.chain_id,OLD.sender,OLD.plan)
 OR (OLD.transaction_hash IS NOT NULL AND ROW(NEW.transaction_hash,NEW.nonce) IS DISTINCT FROM ROW(OLD.transaction_hash,OLD.nonce))
 OR OLD.evidence IS NOT NULL THEN RAISE EXCEPTION 'DEX intent, binding and verified evidence immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER native_dex_execution_guard BEFORE UPDATE OR DELETE ON native_dex_executions
 FOR EACH ROW EXECUTE FUNCTION protect_native_dex_execution();
