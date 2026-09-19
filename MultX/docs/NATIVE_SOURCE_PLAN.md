# Native source wallet plan

prepareNativeSourcePlan prepares three explicit user-wallet transactions: deposit
native value into a reviewed wrapper, approve exactly that amount to the bridge,
and lock the wrapped input for the selected destination. The existing bridge
records the user's wallet as TokensLocked.user. No new production bridge entry
point or intermediary custody is introduced.

Preparation checks chain identity, active policy/expiry, allowed destination,
nonzero distinct parties, positive uint256 input, pinned wrapper/bridge runtime
hashes, token/route support and bridge pause state. The registry is trusted input;
a caller-supplied approval reference is not proof of actual approval. Runtime hash
checks alone do not establish wrapper backing or safety. Production wrappers must
be reviewed as standard native deposit/withdraw implementations; proxies require
separate implementation/configuration verification.

This is a plan builder, not a wallet executor. Gas must remain available in addition
to the input amount. The wallet must refresh policy/route checks before each step,
record transaction hashes and verify receipts before continuing. Never replay the
whole plan after interruption: a successful wrap leaves wrapped funds with the
user, successful approval leaves an allowance, and a successful lock leaves funds
in bridge escrow. Retrying blindly can wrap or lock twice. A pre-lock interruption
can be recovered by a separately reviewed wrapper withdrawal and allowance cleanup;
a post-lock timeout cannot authorize a local refund. Expiry is checked at planning
time, not enforced by the bridge's lock ABI. UI/state integration is still needed.

The two-chain integration test now starts with actual native funds and executes
the three transactions against a local MockNativeWrapper and MultXBridge. It checks
native debit equals input plus receipt gas, zero remaining wrapper balance and
allowance, correct source event sender, real 3-of-5 destination release and verified
native output. Bad runtime identity, unsupported route and expired policy are
rejected. The local wrapper is a test fixture, not a production deployment candidate.

Compile local fixtures from MultX/contracts using the hardhat.payout-local.config.cjs
config before running nativeCrossChain.integration.test.js with the two disposable
nodes and MULTX_CROSS_CHAIN_TEST=1. See NATIVE_PAYOUT_SUBMISSION.md for node/DB setup.
This remains a pre-funded fixed-rate route. No DEX price discovery or execution,
production wrapper selection, production-matching Litho test or activation is implied.

## Source transaction recovery

inspectNativeSourceProgress reads the trusted original plan and three recorded
wallet transaction hashes. It checks chain, exact sender/target/value/calldata,
successful receipts, confirmation depth and canonical blocks. It rejects duplicate
hashes and transactions unrelated to the planned step. A complete inspection
rechecks all three block hashes before returning source_locked. This status only
confirms the source steps; it never marks the cross-chain swap complete.

Recovery states:

- wallet_reconciliation_required: a step has no recorded hash. Inspect wallet
  history; never assume it was not sent or regenerate the whole plan.
- pending_or_unknown: the recorded transaction/receipt is absent, including after
  a reorg. Reconcile that hash/nonce; no automatic replacement is authorized.
- awaiting_finality: a mined step lacks approved confirmations.
- transaction_failed: a matching transaction reverted. Investigate before retry.
- source_locked: all three planned transactions succeeded and passed confirmation
  and canonical-block checks at inspection time.

Partial evidence is diagnostic, not authorization to submit another step. The
function does not sign, broadcast, unwrap, refund or refresh route approval. Wallet
integration must durably retain the original plan and hashes and recheck current
policy before any new signature. This module does not itself provide that storage.

The local two-chain test serializes/restores plan and hashes after each actual
transaction, checks the next unresolved step, rejects duplicate/unrelated hashes
and insufficient finality, and simulates source-chain rollback using evm_revert.
After rollback, recovery reports pending_or_unknown rather than permitting replay.
The rollback occurs after the successful payout assertions: it demonstrates the
limits of finality assumptions and does not reverse the destination payment.

## Durable source intent

Migration 015 adds immutable source plans and per-step transaction bindings.
createNativeSourceIntent prepares the checked plan and binds it to an existing
awaiting-settlement swap with the same destination chain. A conflicting plan cannot
replace it. bindSignedNativeSourceStep recovers the signer and checks chain,
recipient contract, value and calldata against the stored step before recording
the hash and nonce. Each step accepts one hash; chain/sender/nonce and chain/hash
uniqueness prevent assigning the same transaction twice. New bindings require an
unexpired intent and increasing nonce order. Identical bindings are idempotent.

The wallet must bind the signed transaction before broadcasting those exact bytes.
recoverNativeSourceIntent reloads the plan and hashes from PostgreSQL and performs
the existing read-only recovery checks. It works after reconnect without relying
on an in-memory transaction list. Signed bytes remain with the wallet; no private
keys or raw signed transactions are stored in these tables. Replacement/fee-bump
transactions require a separately designed recovery path and are rejected here.

Tests reconnect PostgreSQL after binding each actual source transaction and before
broadcast, confirm pending_or_unknown, then broadcast and recover the completed
step from database records. Changed value and conflicting plans are rejected.
The two-chain rehearsal still finishes with verified native payout.

This is an internal integration interface. Wallets that only expose sendTransaction
and cannot return a signed payload before broadcast need a separate compatible
handoff design. Wallet UI/API wiring, caller authentication, fresh approval checks
before sending, receipt finality between steps and durable signed-byte retention
remain required. Binding alone never authorizes broadcast or proves a step mined.
The candidate migration has only been applied to disposable local test schemas.
