# Signed payout binding

nativeSignedPayout.js accepts a signed legacy EVM transaction from an external
custody implementation. It recovers the sender and checks every execution field
against the immutable draft and swap: chain, nonce, sender, recipient, value,
empty calldata, gas limit and gas price. It rechecks enabled/unexpired policy,
custody reference and explicit finality before creating the payout assignment.

Only the transaction hash and assignment fields are persisted; signed bytes stay
with the caller. No key is loaded, no transaction is signed by this module, and
no broadcast occurs. Valid signature recovery proves control for this signed
transaction, not approval of the production custody arrangement.

Binding is idempotent for the same transaction. Different payloads cannot replace
the reservation. Assignment creation and conflict checks run in one database
transaction under the swap/draft locks. A successful binding leaves the swap
payout_ready; only independent mined-payout verification can complete it.

Real PostgreSQL tests use ephemeral wallets to sign synthetic drafts. They reject
changed recipient, value, nonce, chain, gas limit, gas price, calldata and signer;
concurrent replay creates one assignment, and policy revocation rejects binding.
All 137 API tests pass with both database tests enabled.

Submission-time checks and retry-safe broadcast now use this binding; see
NATIVE_PAYOUT_SUBMISSION.md. Actual custody integration and worker wiring remain
required. The broadcaster must use this bound transaction, not the older internal
arbitrary-assignment helper. This is an EOA legacy-transfer candidate, not Safe transaction support.
No production keys, signed payloads, migrations or broadcasts were used.
