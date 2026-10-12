# B-02 / B-04 candidate procedure

This candidate requires independent review and new immutable images. It does not
authorize any production change. Existing signer journals must not be reset.

## Evidence verification

Each provider role has a durable finalized number/hash checkpoint. Every sample
checks both latest heads, finalized monotonicity, equal-height identity and the
previous finalized block's continuity. Sampling and checkpoint writes are serialized.
Writes use an owner-only temporary file, file fsync, atomic rename and directory
fsync. Missing, corrupt, externally changed or wrongly bound files stop verification.
The checksum detects corruption; it is not protection against a compromised OS or
custodian rewriting both data and checksum. Backups and offline restore controls
remain required. Run only one signer/relay consumer per checkpoint file.

Latest-head decreases above finalized are logged as LATEST_HEAD_REGRESSION,
without HOLD. Latest below finalized rejects. This runtime does not query safe;
the separate B-03 diagnostic must check safe ordering and collect the 72-hour record.
No confirmation-depth-only acceptance is permitted. Each RPC operation has a
10-second deadline; timeout rejects. Raw errors and private URLs are not logged.

Both providers must agree on receipts, vault event content, state results and block
timestamps. State calls use EIP-1898 blockHash with requireCanonical=true; no
number-based fallback exists. Unsupported RPC methods stop verification.

## Excluded execution paths

Production signer startup refuses SIGNER_RELEASE_SIGNING_ENABLED=true. Production
API startup refuses MULTX_ENABLED=true. Therefore legacy sourceEvidence,
destinationSettlement, direct payout, API settlement and DEX completion cannot
execute through this candidate's production entrypoints. Native execution uses the
four guarded signer routes and the separately approved one-shot native relay.
These restrictions deliberately apply to all chains in this candidate, including
Base. They must not be removed through environment overrides for a canary.

## Checkpoint preparation and recovery

Keep signing disabled. For each previously never-active native signer identity,
prepare an approval JSON with firstUse=true, policySha256 (exact private policy
file), binding, and absolute checkpointFile. Binding is computed using the exported
finalityCheckpointBinding(parsedPolicy, approvedStateIdentity). The signer path is
SIGNER_NATIVE_STATE_FILE + '.finality-checkpoints'. The relayer uses the exact
approval.finalityCheckpointFile path and binding finalityCheckpointBinding(policy).
All checkpoint files belong in the protected native journal storage.

Only after recorded first-use approval, on the correct owner-only filesystem:

    node scripts/initialize-finality-checkpoints.mjs <approval.json> <sha256> <policy.json> <state-identity.json>

For the relay, replace the last argument with `relay`. This command never resets an
existing file and is never run automatically at startup. Already-used identities
require approved checkpoint AND journal backups; unknown history stays on HOLD.
Retain policy/identity bindings and checkpoint backups privately. Neither an empty
directory nor absence of a file proves first use.

## HOLD policy and remaining review

The existing conservative HOLD-on-every-rejection behavior is retained; no waiver
or retryable exception is introduced. KaJ Labs must accept B2-5(a) and the
coordinator must demonstrate finalized-on-both prevalidation before submission.
HOLD emits a sanitized NATIVE_FINALITY_HOLD event and survives restart. Recovery
requires recorded offline reconciliation; there is no automatic retry/reset.

The source tests are local regression evidence, not the required D-6 run against
published image digests. O23-6 signatures/provenance, O23-7 running image binding,
B-03 reviewed diagnostics/72 hours, G-02 and bounded-canary approval remain open.
