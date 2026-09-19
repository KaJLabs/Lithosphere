CREATE TABLE native_redemptions (
 swap_id TEXT PRIMARY KEY REFERENCES native_dex_executions(swap_id),
 policy_id TEXT NOT NULL REFERENCES native_route_policies(policy_id),
 chain_id BIGINT NOT NULL CHECK(chain_id>0),
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
CREATE UNIQUE INDEX native_redemption_plan_nonce ON native_redemptions
 (chain_id,sender,(plan->'transaction'->>'nonce'));
CREATE TRIGGER native_redemption_guard BEFORE UPDATE OR DELETE ON native_redemptions
 FOR EACH ROW EXECUTE FUNCTION protect_native_dex_execution();
CREATE FUNCTION require_native_redemption_before_payout() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM native_route_policies p WHERE p.policy_id=NEW.policy_id AND p.policy->'nativeOutput' IS NOT NULL)
 AND NOT EXISTS(SELECT 1 FROM native_redemptions r WHERE r.swap_id=NEW.swap_id AND r.policy_id=NEW.policy_id AND r.evidence IS NOT NULL)
 THEN RAISE EXCEPTION 'verified native redemption required before payout draft'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER native_redemption_payout_guard BEFORE INSERT ON native_payout_drafts
 FOR EACH ROW EXECUTE FUNCTION require_native_redemption_before_payout();
