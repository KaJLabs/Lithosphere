-- Reconcile earlier candidate readiness records; do not manufacture evidence.
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM native_swaps WHERE state IN ('payout_ready','completed')) THEN
  RAISE EXCEPTION 'reconcile existing ready/completed swaps before destination readiness migration';
 END IF;
END $$;
CREATE TABLE native_route_policies (
 policy_id TEXT PRIMARY KEY CHECK(length(trim(policy_id))>0),
 policy JSONB NOT NULL,
 approval_ref TEXT NOT NULL CHECK(length(trim(approval_ref))>0),
 approved_by TEXT NOT NULL CHECK(length(trim(approved_by))>0),
 expires_at TIMESTAMPTZ NOT NULL,
 enabled BOOLEAN NOT NULL DEFAULT false
);
CREATE TABLE native_swap_destinations (
 swap_id TEXT PRIMARY KEY REFERENCES native_swap_sources(swap_id),
 policy_id TEXT NOT NULL REFERENCES native_route_policies(policy_id),
 destination_chain BIGINT NOT NULL CHECK(destination_chain>0),
 transaction_hash TEXT NOT NULL CHECK(transaction_hash ~ '^0x[0-9a-f]{64}$'),
 expectation JSONB NOT NULL,
 verified_evidence JSONB,
 verified_at TIMESTAMPTZ,
 UNIQUE(destination_chain,transaction_hash),
 CHECK((verified_evidence IS NULL)=(verified_at IS NULL))
);
CREATE FUNCTION protect_native_destination() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'destination assignment cannot be deleted'; END IF;
 IF ROW(NEW.swap_id,NEW.policy_id,NEW.destination_chain,NEW.transaction_hash,NEW.expectation)
 IS DISTINCT FROM ROW(OLD.swap_id,OLD.policy_id,OLD.destination_chain,OLD.transaction_hash,OLD.expectation)
 OR OLD.verified_evidence IS NOT NULL THEN RAISE EXCEPTION 'destination assignment/evidence immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER native_destination_guard BEFORE UPDATE OR DELETE ON native_swap_destinations
 FOR EACH ROW EXECUTE FUNCTION protect_native_destination();
CREATE FUNCTION protect_native_route_policy() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'route policy cannot be deleted'; END IF;
 IF ROW(NEW.policy_id,NEW.policy,NEW.approval_ref,NEW.approved_by,NEW.expires_at)
 IS DISTINCT FROM ROW(OLD.policy_id,OLD.policy,OLD.approval_ref,OLD.approved_by,OLD.expires_at)
 THEN RAISE EXCEPTION 'create a new version for changed route policy'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER native_route_policy_guard BEFORE UPDATE OR DELETE ON native_route_policies
 FOR EACH ROW EXECUTE FUNCTION protect_native_route_policy();
CREATE FUNCTION require_native_destination_before_readiness() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.state='payout_ready' AND OLD.state IS DISTINCT FROM NEW.state AND NOT EXISTS (
  SELECT 1 FROM native_swap_destinations d JOIN native_route_policies p USING(policy_id)
   WHERE d.swap_id=NEW.swap_id AND d.verified_evidence IS NOT NULL
    AND p.enabled AND p.expires_at>clock_timestamp()
    AND NEW.route_policy_ref=p.policy_id AND NEW.settlement_evidence_ref=d.transaction_hash
 ) THEN RAISE EXCEPTION 'verified destination and active approved route required'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER native_readiness_destination_guard BEFORE UPDATE ON native_swaps
 FOR EACH ROW EXECUTE FUNCTION require_native_destination_before_readiness();
