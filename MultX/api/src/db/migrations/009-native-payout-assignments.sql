-- Developer candidate; apply only with the coordinated native payout release.
CREATE TABLE native_payout_assignments (
 swap_id TEXT PRIMARY KEY CHECK (length(trim(swap_id)) BETWEEN 1 AND 200),
 chain_id BIGINT NOT NULL CHECK (chain_id BETWEEN 1 AND 9007199254740991),
 transaction_hash TEXT NOT NULL CHECK (transaction_hash ~ '^0x[0-9a-f]{64}$'),
 sender TEXT NOT NULL CHECK (sender ~ '^0x[0-9a-f]{40}$' AND sender <> '0x0000000000000000000000000000000000000000'),
 recipient TEXT NOT NULL CHECK (recipient ~ '^0x[0-9a-f]{40}$' AND recipient <> '0x0000000000000000000000000000000000000000' AND recipient <> sender),
 nonce BIGINT NOT NULL CHECK (nonce BETWEEN 0 AND 9007199254740991),
 minimum_output NUMERIC(78,0) NOT NULL CHECK (minimum_output > 0 AND minimum_output < power(2::numeric,256)),
 confirmations INTEGER NOT NULL CHECK (confirmations > 0),
 state TEXT NOT NULL DEFAULT 'assigned' CHECK (state IN ('assigned','verified')),
 evidence JSONB,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 verified_at TIMESTAMPTZ,
 UNIQUE (chain_id, transaction_hash),
 UNIQUE (chain_id, sender, nonce),
 CHECK ((state='assigned' AND evidence IS NULL AND verified_at IS NULL) OR
        (state='verified' AND evidence IS NOT NULL AND verified_at IS NOT NULL))
);
CREATE FUNCTION protect_native_payout_assignment() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP = 'DELETE' THEN
  RAISE EXCEPTION 'native payout assignment cannot be deleted';
 END IF;
 IF ROW(NEW.swap_id,NEW.chain_id,NEW.transaction_hash,NEW.sender,NEW.recipient,NEW.nonce,NEW.minimum_output,NEW.confirmations)
 IS DISTINCT FROM ROW(OLD.swap_id,OLD.chain_id,OLD.transaction_hash,OLD.sender,OLD.recipient,OLD.nonce,OLD.minimum_output,OLD.confirmations)
 OR OLD.state='verified' THEN
  RAISE EXCEPTION 'native payout assignment or verified evidence is immutable';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER native_payout_immutable BEFORE UPDATE OR DELETE ON native_payout_assignments
 FOR EACH ROW EXECUTE FUNCTION protect_native_payout_assignment();
