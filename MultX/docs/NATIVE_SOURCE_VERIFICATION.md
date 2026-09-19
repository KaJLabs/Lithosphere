# Native swap source-lock evidence

Migration 011 binds a source lock to one swap using source chain, bridge and lock
identifier. Expectations are immutable and entered by the internal coordinator,
not public input. nativeSourceSettlement.js loads those expectations under a
swap/assignment lock and reuses verifySourceEvidence to check the configured
chain/bridge, confirmations, canonical block and exact TokensLocked event fields.
Evidence is persisted once; replay revalidates canonical source evidence. A lock
cannot be assigned to another swap. Removed/reorged evidence fails closed.

The database prevents entry into payout_ready without recorded source evidence.
Verification itself leaves the swap awaiting_settlement. A source lock is not
destination settlement, native-input proof or funded destination liquidity.
Readiness still needs destination settlement verification and approved route
policy. Nonempty references must not be treated as those checks. Existing ready
rows from earlier candidate migrations require reconciliation before rollout;
the new trigger governs transitions and does not validate historical rows.

The adapter currently verifies the existing bridge TokensLocked format; the lock
identifier is not necessarily a blockchain transaction hash. Native input
adapters and token/native accounting must separately establish the user's input.
RPC and chain policy are operator-controlled dependencies. No endpoint, public
assignment interface or automatic payout-readiness producer is enabled.

Real PostgreSQL integration tests use synthetic RPC events to verify source-lock
uniqueness, failure rollback, replay, reorg rejection and the readiness guard.
All 121 API tests pass with the integration test enabled. This is developer
evidence, not mainnet source settlement or audit acceptance.
