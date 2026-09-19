-- Do not guess whether an earlier externally signed trade was raw or injected.
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM native_dex_executions WHERE transaction_hash IS NOT NULL) THEN
  RAISE EXCEPTION 'reconcile existing DEX submissions before destination wallet mode migration';
 END IF;
END $$;
CREATE TABLE native_destination_wallet_modes (
 swap_id TEXT PRIMARY KEY REFERENCES native_swaps(swap_id),
 mode TEXT NOT NULL CHECK(mode IN ('raw','injected'))
);
CREATE TRIGGER native_destination_mode_guard BEFORE UPDATE OR DELETE ON native_destination_wallet_modes
 FOR EACH ROW EXECUTE FUNCTION protect_native_source_intent();
CREATE TABLE native_destination_wallet_steps (
 swap_id TEXT NOT NULL REFERENCES native_swaps(swap_id),
 step INTEGER NOT NULL CHECK(step IN (0,1)),
 policy_id TEXT NOT NULL REFERENCES native_route_policies(policy_id),
 chain_id BIGINT NOT NULL CHECK(chain_id>0),
 sender TEXT NOT NULL,
 plan JSONB NOT NULL,
 attempt_id TEXT CHECK(attempt_id ~ '^0x[0-9a-f]{64}$'),
 transaction_hash TEXT CHECK(transaction_hash ~ '^0x[0-9a-f]{64}$'),
 nonce BIGINT CHECK(nonce>=0),
 PRIMARY KEY(swap_id,step),
 UNIQUE(chain_id,transaction_hash),
 UNIQUE(chain_id,sender,nonce),
 CHECK((transaction_hash IS NULL)=(nonce IS NULL)),
 CHECK(transaction_hash IS NULL OR attempt_id IS NOT NULL)
);
CREATE FUNCTION protect_native_destination_step() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'destination step cannot be deleted'; END IF;
 IF ROW(NEW.swap_id,NEW.step,NEW.policy_id,NEW.chain_id,NEW.sender,NEW.plan) IS DISTINCT FROM
    ROW(OLD.swap_id,OLD.step,OLD.policy_id,OLD.chain_id,OLD.sender,OLD.plan)
 OR (OLD.attempt_id IS NOT NULL AND NEW.attempt_id IS DISTINCT FROM OLD.attempt_id)
 OR (OLD.transaction_hash IS NOT NULL AND ROW(NEW.transaction_hash,NEW.nonce) IS DISTINCT FROM ROW(OLD.transaction_hash,OLD.nonce))
 THEN RAISE EXCEPTION 'destination plan, attempt and binding immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER native_destination_step_guard BEFORE UPDATE OR DELETE ON native_destination_wallet_steps
 FOR EACH ROW EXECUTE FUNCTION protect_native_destination_step();
