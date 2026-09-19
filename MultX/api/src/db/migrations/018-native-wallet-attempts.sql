CREATE TABLE native_wallet_attempts (
 swap_id TEXT NOT NULL REFERENCES native_source_intents(swap_id),
 step INTEGER NOT NULL CHECK(step BETWEEN 0 AND 2),
 attempt_id TEXT NOT NULL CHECK(attempt_id ~ '^0x[0-9a-f]{64}$'),
 PRIMARY KEY(swap_id,step)
);
CREATE TRIGGER native_wallet_attempt_guard BEFORE UPDATE OR DELETE ON native_wallet_attempts
 FOR EACH ROW EXECUTE FUNCTION protect_native_source_intent();
