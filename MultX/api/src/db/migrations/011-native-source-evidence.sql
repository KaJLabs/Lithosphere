CREATE TABLE native_swap_sources (
 swap_id TEXT PRIMARY KEY REFERENCES native_swaps(swap_id),
 source_chain BIGINT NOT NULL CHECK (source_chain>0),
 source_bridge TEXT NOT NULL CHECK(source_bridge ~ '^0x[0-9a-f]{40}$'),
 source_lock_hash TEXT NOT NULL CHECK(source_lock_hash ~ '^0x[0-9a-f]{64}$'),
 expectation JSONB NOT NULL,
 verified_evidence JSONB,
 verified_at TIMESTAMPTZ,
 UNIQUE(source_chain,source_bridge,source_lock_hash),
 CHECK((verified_evidence IS NULL)=(verified_at IS NULL))
);
CREATE FUNCTION protect_native_source() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'source evidence cannot be deleted'; END IF;
 IF ROW(NEW.swap_id,NEW.source_chain,NEW.source_bridge,NEW.source_lock_hash,NEW.expectation)
 IS DISTINCT FROM ROW(OLD.swap_id,OLD.source_chain,OLD.source_bridge,OLD.source_lock_hash,OLD.expectation)
 OR OLD.verified_evidence IS NOT NULL THEN RAISE EXCEPTION 'source assignment/evidence immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER native_source_guard BEFORE UPDATE OR DELETE ON native_swap_sources
 FOR EACH ROW EXECUTE FUNCTION protect_native_source();

CREATE FUNCTION require_native_source_before_readiness() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.state='payout_ready' AND OLD.state IS DISTINCT FROM NEW.state AND NOT EXISTS (
  SELECT 1 FROM native_swap_sources s WHERE s.swap_id=NEW.swap_id AND s.verified_evidence IS NOT NULL
 ) THEN RAISE EXCEPTION 'verified source required before payout readiness'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER native_readiness_source_guard BEFORE UPDATE ON native_swaps
 FOR EACH ROW EXECUTE FUNCTION require_native_source_before_readiness();
