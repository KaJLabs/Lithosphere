-- Existing intents with submissions need an explicit reviewed mode assignment.
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM native_wallet_attempts) OR EXISTS(SELECT 1 FROM native_source_transactions) THEN
  RAISE EXCEPTION 'reconcile existing native submissions before wallet mode migration';
 END IF;
END $$;
CREATE TABLE native_wallet_modes (
 swap_id TEXT PRIMARY KEY REFERENCES native_source_intents(swap_id),
 mode TEXT NOT NULL CHECK(mode IN ('raw','injected'))
);
CREATE TRIGGER native_wallet_mode_guard BEFORE UPDATE OR DELETE ON native_wallet_modes
 FOR EACH ROW EXECUTE FUNCTION protect_native_source_intent();
