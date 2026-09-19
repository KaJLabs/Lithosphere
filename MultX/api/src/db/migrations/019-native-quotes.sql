CREATE TABLE native_quotes (
 quote_id TEXT PRIMARY KEY CHECK(quote_id ~ '^0x[0-9a-f]{64}$'),
 wallet TEXT NOT NULL CHECK(wallet ~ '^0x[0-9a-f]{40}$'),
 policy_id TEXT NOT NULL REFERENCES native_route_policies(policy_id),
 request JSONB NOT NULL,
 source_plan JSONB NOT NULL,
 expires_at TIMESTAMPTZ NOT NULL,
 accepted_at TIMESTAMPTZ,
 UNIQUE(policy_id,wallet,quote_id)
);
-- An approved fixed-fill policy represents one funded fill. A new approval/version
-- is needed for the next fill; expiry never frees an accepted commitment.
CREATE UNIQUE INDEX native_quote_policy_fill ON native_quotes(policy_id)
 WHERE accepted_at IS NOT NULL;
CREATE FUNCTION protect_native_quote() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'native quote cannot be deleted'; END IF;
 IF ROW(NEW.quote_id,NEW.wallet,NEW.policy_id,NEW.request,NEW.source_plan,NEW.expires_at)
    IS DISTINCT FROM ROW(OLD.quote_id,OLD.wallet,OLD.policy_id,OLD.request,OLD.source_plan,OLD.expires_at)
 OR OLD.accepted_at IS NOT NULL OR NEW.accepted_at IS NULL
 THEN RAISE EXCEPTION 'native quote is immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER native_quote_guard BEFORE UPDATE OR DELETE ON native_quotes
 FOR EACH ROW EXECUTE FUNCTION protect_native_quote();
