-- Internal coordinator state. No public request may declare payout readiness.
CREATE TABLE native_swaps (
 swap_id TEXT PRIMARY KEY CHECK (length(trim(swap_id)) BETWEEN 1 AND 200),
 destination_chain BIGINT NOT NULL CHECK (destination_chain BETWEEN 1 AND 9007199254740991),
 recipient TEXT NOT NULL CHECK (recipient ~ '^0x[0-9a-f]{40}$'),
 minimum_output NUMERIC(78,0) NOT NULL CHECK (minimum_output > 0 AND minimum_output < power(2::numeric,256)),
 state TEXT NOT NULL DEFAULT 'awaiting_settlement' CHECK (state IN ('awaiting_settlement','payout_ready','recovery_required','completed')),
 settlement_evidence_ref TEXT,
 route_policy_ref TEXT,
 completed_at TIMESTAMPTZ,
 CHECK (state NOT IN ('payout_ready','completed') OR
  (length(trim(settlement_evidence_ref))>0 AND settlement_evidence_ref IS NOT NULL AND
   length(trim(route_policy_ref))>0 AND route_policy_ref IS NOT NULL)),
 CHECK ((state='completed') = (completed_at IS NOT NULL))
);
-- Fail on orphan assignments: never infer historical swap eligibility in migration.
ALTER TABLE native_payout_assignments ADD CONSTRAINT native_payout_swap_fk
 FOREIGN KEY (swap_id) REFERENCES native_swaps(swap_id);
CREATE FUNCTION protect_native_swap_completion() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.state<>'awaiting_settlement' THEN RAISE EXCEPTION 'new swap must await settlement'; END IF;
  RETURN NEW;
 END IF;
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'native swap cannot be deleted'; END IF;
 IF OLD.state='completed' THEN RAISE EXCEPTION 'completed swap is immutable'; END IF;
 IF ROW(NEW.swap_id,NEW.destination_chain,NEW.recipient,NEW.minimum_output)
 IS DISTINCT FROM ROW(OLD.swap_id,OLD.destination_chain,OLD.recipient,OLD.minimum_output) THEN
  RAISE EXCEPTION 'swap payout terms are immutable';
 END IF;
 IF NEW.state='completed' AND (OLD.state<>'payout_ready' OR NOT EXISTS (
  SELECT 1 FROM native_payout_assignments p WHERE p.swap_id=NEW.swap_id AND p.state='verified'
   AND p.chain_id=NEW.destination_chain AND p.recipient=NEW.recipient AND p.minimum_output>=NEW.minimum_output
 )) THEN RAISE EXCEPTION 'verified matching payout required'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER native_swap_completion_guard BEFORE INSERT OR UPDATE OR DELETE ON native_swaps
 FOR EACH ROW EXECUTE FUNCTION protect_native_swap_completion();
