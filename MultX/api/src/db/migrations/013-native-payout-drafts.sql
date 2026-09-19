CREATE TABLE native_payout_drafts (
 swap_id TEXT PRIMARY KEY REFERENCES native_swaps(swap_id),
 policy_id TEXT NOT NULL REFERENCES native_route_policies(policy_id),
 chain_id BIGINT NOT NULL,
 sender TEXT NOT NULL,
 nonce BIGINT NOT NULL CHECK(nonce>=0),
 custody_ref TEXT NOT NULL CHECK(length(trim(custody_ref))>0),
 transaction JSONB NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(chain_id,sender,nonce)
);
CREATE FUNCTION protect_native_payout_draft() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'payout draft is immutable; reconcile instead of replacing'; END $$;
CREATE TRIGGER native_payout_draft_guard BEFORE UPDATE OR DELETE ON native_payout_drafts
 FOR EACH ROW EXECUTE FUNCTION protect_native_payout_draft();
