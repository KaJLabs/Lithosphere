# Direct native payout evidence

`api/src/services/nativePayoutEvidence.js` provides a read-only verifier for a
direct native-asset transfer. It checks a trusted payout assignment against an
ethers v6 provider: chain, transaction hash, sender, recipient, nonce, successful
receipt, empty calldata, minimum value, configured confirmations, canonical block
and recipient native-balance credit. It rechecks the block after reading state.

The assignment must come from durable coordinator state. Never accept it directly
from a public request or quote. Persist a unique `(chainId, transactionHash)`
binding before verification and consume the returned evidence atomically with
the swap transition. This stateless module does not prevent transaction reuse,
authenticate RPC servers, authorize spending, or mark swaps completed.

Historical native balances are required. A recipient spending within the same
block may cause a conservative rejection. Contract recipients and contract-led
payouts need a separate reviewed adapter; they must not be forced through this
direct-transfer check. Empty runtime code alone is not proof of an EOA on chains
with native precompiles; recipient policy must exclude reserved/system addresses.

Confirmation counts are deployment-policy inputs, not approvals encoded here.
Rechecking canonical blocks narrows a reorg race but cannot guarantee permanence;
the coordinator must apply the approved finality policy and recovery monitoring.
Tests use synthetic RPC responses and do not establish a deployed funded route.

Next integration requirement: durable payout assignment and one-time evidence
consumption in the coordinator. Production completion/status endpoints remain
unwired until that ownership and recovery behavior is implemented and tested.

The candidate migration 009 and nativePayoutStore.js now supply immutable durable
assignments with unique chain/transaction and chain/sender/nonce constraints.
Repeated identical assignment is idempotent; conflicting assignment fails.
Verification locks the assignment, derives expectations from the stored row,
and records evidence once. Verification failure rolls back to assigned. Already
verified records return the saved evidence without another RPC call. This is
cached historical evidence, not a fresh finality check.

The database rejects assignment edits, deletion and changes to verified records.
Administrative TRUNCATE, schema changes and privileged database access remain
outside that protection; production database permissions must exclude them from
the runtime role. Replacement transactions deliberately require a future reviewed
recovery workflow; overwriting an assignment is not supported.

The state is payout `verified`, not swap `completed`. Upstream eligibility,
approved route/recipient policy, durable swap linkage, source settlement and the
atomic overall swap transition still need coordinator integration. The functions
are internal and are not mounted as public endpoints. RPC verification has a
15-second lock-holding timeout; provider work may finish after timeout but cannot
write the verification result through this transaction.

Real PostgreSQL tests cover uniqueness, immutability, concurrent verification,
failure rollback and reconnect recovery. Run the opt-in integration test only
against its fixed disposable endpoint, never production. Migration 009 has not
been applied to production.

Migration 010 now links each assignment to a native_swaps row. New swaps start
awaiting_settlement. Assignment/verification requires payout_ready with stored
settlement and route-policy references, matching destination/recipient and a
payout minimum no lower than the swap minimum. Verification locks the swap first,
then its assignment, and records payout evidence and completed state in one
transaction. An injected completion failure rolls both changes back. Completed
swap terms and records are immutable, and replay returns the saved result.

This supersedes the earlier missing-linkage/atomic-transition note above. There
is still no readiness producer: a trusted source-settlement verifier and approved
route policy must populate the references and authorize payout_ready. Nonempty
reference strings are audit linkage, not proof of settlement or policy approval.
No public endpoint or automatic source-event transition has been wired.

Migration 010 deliberately fails if pre-existing assignments lack corresponding
swap rows; reconcile those using actual evidence before applying it. It does not
invent eligibility or backfill completed swaps. The integration test uses explicit
synthetic readiness fixtures on a fresh schema, not production settlement evidence.
