CREATE TABLE native_payout_submissions (
 swap_id TEXT PRIMARY KEY REFERENCES native_payout_assignments(swap_id),
 transaction_hash TEXT NOT NULL UNIQUE,
 state TEXT NOT NULL CHECK(state IN ('submitted','uncertain')),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Signed bytes stay with custody. Every retry must resupply the identical bound payload.
