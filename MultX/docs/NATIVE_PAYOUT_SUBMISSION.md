# Native payout submission and completion

Current DEX-backed delivery requires canonical native redemption before payout
submission and completion. The pre-funded rehearsal and test totals later in this
file describe an earlier revision. See [NATIVE_REDEMPTION.md](NATIVE_REDEMPTION.md)
and [current completion checklist](NATIVE_SWAP_COMPLETION_CHECKLIST.md).

Internal candidate: submitBoundNativePayout accepts only the signed transaction
matching the durable draft and payout assignment. It checks active policy and
chain identity, then looks up the bound hash before attempting broadcast.
For a new broadcast it rechecks source and destination settlement evidence,
nonce, account code, sender funds, gas and policy expiry.

An RPC broadcast error records uncertain, because the node may have accepted the
transaction. Retry uses the identical signed bytes and hash; it cannot construct
a replacement payout. Custody must retain and resupply those bytes after restart.
A submitted result means RPC acceptance/visibility, never swap completion.

verifyAndRecordNativePayout performs receipt reconciliation. It requires the
assigned transaction, successful receipt, canonical block, approved confirmation
count and independently observed native recipient balance credit. It records
evidence and completes the swap atomically. Concurrent reconciliation completes
once. Revoking a route blocks submission but allows recording a payout that has
already happened. Completed replay returns stored evidence, not a fresh reorg check.

Validation uses real local PostgreSQL, an ephemeral signing wallet and synthetic
RPC responses. It covers a lost broadcast response, hash-based retry with one
broadcast, policy revocation, missing receipt, insufficient confirmations, absent
native credit and concurrent completion. It is not a live-chain rehearsal.

Remaining launch work: production-approved routes and liquidity, payout custody
integration, custody/submission coordinator wiring, local chain execution
rehearsal, consolidated review and deployment approval. The implementation remains
an EOA legacy-transfer candidate; it does not implement general DEX routing or Safe
payout execution. No production migration, broadcast or activation occurred.

## Receipt worker

From MultX/api, run `node src/nativePayoutMonitor.mjs --once` for one complete
scan, or omit `--once` to poll. Configure PostgreSQL through standard PGHOST,
PGPORT, PGUSER, PGPASSWORD and PGDATABASE variables. Set MULTX_PAYOUT_RPC_FILE
to an operator-managed JSON file mapping chain IDs to approved HTTP(S) RPC URLs.
Do not commit credentials. Required migrations must already be applied to the
intended candidate database; the worker does not run migrations or start with API.

The worker reads durable assignments, so it can discover a mined payout even if
submission crashed before saving RPC acceptance. Batches advance past unverified
receipts and missing providers; after a scan, pending assignments are revisited.
On restart the cursor starts over; completed swaps are excluded. Existing database
locks and atomic completion protect concurrent reconciliation. Revoked policies do
not prevent recording an already-mined payout. RPC failures leave swaps incomplete.
Output contains swap ID and completed, unverified or provider_missing status;
unverified requires retry/investigation and is not a terminal failure declaration.

The worker performs read-only chain calls and writes verified completion to the
configured database. It cannot sign or broadcast. Shutdown finishes the current
bounded verification and stops before the next assignment. Local PostgreSQL tests
exercise missing providers, pending receipts, cursor wrap and restart discovery,
then completion and duplicate exclusion. RPCs remain simulated; live-chain execution
and the full custody/submission coordinator are still outstanding.

## Disposable EVM payout rehearsal (2026-09-13)

All 137 API tests passed with local PostgreSQL and MULTX_PAYOUT_LOCAL_EVM=1.
Start Hardhat from MultX/contracts with:

    node node_modules/hardhat/internal/cli/cli.js --config hardhat.payout-local.config.cjs node --hostname 127.0.0.1 --port 18546

Then run the API tests with MULTX_PAYOUT_DB_TEST=1 and
MULTX_PAYOUT_LOCAL_EVM=1. The existing disposable PostgreSQL fixture must be
running on localhost:55441. Stop both disposable services afterward.

The local config has no accounts, remote networks or dotenv loading. The test
checks Hardhat identity and chain ID before funding a random ephemeral wallet via
hardhat_setBalance. It prepares and signs a draft, broadcasts a real local native
transfer, simulates losing the response, recovers via the real transaction hash,
mines confirmations and verifies real receipt and native balance credit through
the reconciliation worker. One broadcast completes one durable swap. The test
also checks that insufficient confirmations cannot complete the swap.

Source and destination bridge-settlement evidence still use synthetic fixtures.
This validates the native payout leg, not the full cross-chain bridge or production
Litho runtime. Hardhat's lab chain ID 9005 does not make it a Litho node. Production
custody, deployed routes/liquidity, full coordinator integration and consolidated
security acceptance remain outstanding. No production changes were made.

## Custody/submission coordinator

`coordinateNativePayout` now connects immutable draft preparation, custody handoff,
signed-payload validation and retry-safe submission for an already payout-ready
swap. Its default returns `prepared` with a request; submission requires the caller
to explicitly pass `submit: true`. A missing signed artifact returns
`awaiting_custody`. A mismatched custody reference or signed transaction is rejected.
Completed swaps return without contacting custody or broadcasting.

The request ID commits to a versioned domain, swap ID, policy ID, custody reference,
sender and the unsigned transaction hash. `createFilePayoutCustody` reads
`<requestId>.signed` from an absolute operator-managed directory. The file contains
only the externally signed raw transaction in hexadecimal. Custody should publish
it atomically, restrict directory access, retain it across restarts and never
replace its contents. The coordinator independently checks every signed field and
existing hash binding before allowing submission. No signing key is loaded here.

This handoff supports an external EOA signer. It does not convert the MultX signing
Safe into a native payout account, implement KMS signing, or establish production
custody approval. The source adapter and route policy must come from trusted
operator configuration; no public request may supply them. The coordinator is an
internal callable entry point, not an automatically enabled API endpoint or daemon.

The local rehearsal now invokes the coordinator with actual signed file handoff,
rejects missing/wrong custody and modified amount, simulates a lost broadcast
response, reopens the custody adapter and reconciles the original hash without a
second broadcast. The receipt worker independently verifies completion. Source
and destination bridge evidence remain synthetic fixtures. Production launch still
requires approved payout custody/routes/liquidity, application wiring, a complete
cross-chain rehearsal and consolidated review/deployment approval.

## Two-chain contract rehearsal (2026-09-13)

nativeCrossChain.integration.test.js replaces all simulated RPC evidence for a
separate full bridge/payout scenario. Two disposable Hardhat chains run on loopback:
source 31337 at port 18547 (hardhat.source-local.config.cjs) and destination lab
9005 at port 18546 (hardhat.payout-local.config.cjs). Both configs have no accounts
or remote networks. The test creates and funds ephemeral wallets locally.

Actual MultXBridge contracts use five random validators and threshold three.
The test locks 2000 source ERC-20 fixture units, verifies the canonical lock,
rejects a two-signature release, releases 1500 pre-funded destination fixture units
with three signatures, and rejects replay. It records real source and destination
evidence, prepares/signs/submits the native payout through the coordinator, retries
the original hash, checks that insufficient finality blocks completion, and then
mines confirmations for the receipt worker. Final assertions verify 2000 units in
source escrow, 1500 units at the settlement holder and 1000 native base units at
the recipient, with one verified payout assignment.

Run the API suite with MULTX_PAYOUT_DB_TEST=1, MULTX_PAYOUT_LOCAL_EVM=1 and
MULTX_CROSS_CHAIN_TEST=1 using `node --test --test-concurrency=1` after starting the
two local nodes and disposable PostgreSQL fixture. Serial execution prevents the
other payout test's mining from changing this test's confirmation assumptions.
The deployed MultXBridge and MockERC20 artifact build inputs were checked against
the current Solidity source files. Local test services were stopped afterward.

This is a pre-funded, fixed-rate ERC-20 bridge-to-native payout rehearsal. Native
source conversion, DEX quote/execution, refunds, production custody, real-chain
finality and production governance are not established by this test. The destination
is Hardhat, not a production-matching Litho node. No mainnet deployment occurred.
