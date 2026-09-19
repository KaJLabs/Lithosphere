# Native source and destination wallet API candidate

Current application assembly, quote creation and mode isolation are documented in
[NATIVE_QUOTE_API.md](NATIVE_QUOTE_API.md) and
[NATIVE_RECOVERY_RUNBOOK.md](NATIVE_RECOVERY_RUNBOOK.md). Historical progress notes
below describe the source flow; the opt-in web UI now includes source and
destination send-only submission and reserved-attempt hash reconciliation, with
production disabled.

createNativeSourceRouter({ pool, registry, audience }) exposes only existing
source intents. It is not mounted by the production API startup. The application
must explicitly mount it at its configured native-source URL after applying
migration 016 and reviewing the configuration. Registry.resolve(swapId) supplies
provider, current policy, original input and approved confirmations from trusted
server configuration. The wallet cannot supply these route settings.

Routes relative to the mount:

- GET /:swapId/steps/:step returns the original wrap/approve/lock transaction.
- POST /:swapId/steps/:step/check accepts {} and checks active eligibility.
- POST /:swapId/steps/:step/bind accepts {"raw":"0x..."}, checks eligibility and
  binds the signed transaction to the immutable source intent.

Every request carries an EIP-191 wallet signature over a versioned message with
configured audience, HTTP method, relative path, canonical JSON body hash,
millisecond timestamp and random 32-byte nonce. The recovered EOA must equal the
source intent's sender. Timestamps allow at most 60 seconds past / 5 seconds future.
Migration 016 consumes each wallet/audience/nonce atomically, rejecting replay.
An accepted signature cannot be moved to another method, path or body. Audience
must uniquely identify the intended deployment/mount and match SDK configuration.
No raw payload/signature is logged. The router limits request body size and rate.

createNativeSourceWalletBackend({ baseUrl, audience, signer }) is the SDK adapter.
Use it with submitNativeSourceStep and openNativeSourceSignedStore. The base URL
includes the router mount; HTTPS is required except loopback rehearsal addresses.
Requests do not follow redirects and have a 15-second HTTP deadline. Rejected
requests require a fresh signature/nonce, not a replay of captured headers.

The current protocol prompts signMessage for each request; wallet session/delegation
support is not implemented. It supports recovered EOA signatures, not EIP-1271
contract-wallet authentication. The separate raw transaction signing requirement
still applies. Intent creation and quote authorization remain trusted coordinator
work; these routes cannot create a route, sign a payout or broadcast transactions.

The application must configure its ingress/CORS/proxy policy, bind the real registry
and maintain nonce storage. Nonces may be pruned only after their timestamp window
has safely elapsed (a day of retention is conservative); no production cleanup or
migration runs automatically. Operational deadlines apply to registry RPCs too.

The two-chain rehearsal mounts Express on an ephemeral loopback port, uses the SDK
HTTP adapter, rejects another wallet, rejects a captured-request replay and rejects
path tampering, then completes the native source and payout flow with real local
contracts and PostgreSQL. This is candidate evidence, not independent security
acceptance, production configuration or browser-wallet compatibility evidence.

## Authenticated progress for application recovery

GET /:swapId/steps/0/status uses the same wallet ownership, request signature and
nonce checks. SDK backend.getProgress(swapId) returns independently inspected
source progress plus the stored overall swapState. Source source_locked means
only the source leg completed; the UI must use swapState for overall completion.
Source inspection runs even for completed swaps, so RPC failure or source reorg
must not be silently hidden by a cached completion display. A changed source after
completed payout requires operator reconciliation, not automatic refund.

The application adapts the injected provider through ethers v6 BrowserProvider.
Native action buttons are rendered only when the feature and exact source, quote
and destination API mounts are configured. Progress calls require signMessage but
do not sign or broadcast a transaction. Each send requires an explicit click; no
polling loop repeatedly prompts the wallet. Local browser tests use an injected
provider fixture, so real extension, WalletConnect and platform staging remain.

## Send-transaction-only wallet candidate

submitInjectedNativeSourceStep is a separate opt-in SDK flow for wallets that do
not expose raw transaction signing. It saves a local attempt marker, then requests
an atomic backend reservation before opening sendTransaction. Migration 018 permits
one reservation per source step across tabs/devices. POST reserve takes attemptId;
POST observe takes transactionHash. Both use the same wallet request authentication.
The observe route retrieves the transaction from the trusted chain provider,
reconstructs its signed payload and uses the existing exact-intent binding checks.

A returned hash is retained locally before observation; replay observes that hash
without sending again. A lost wallet/reservation response or rejected wallet prompt
leaves wallet_reconciliation_required. There is deliberately no automatic reset or
retry permission. The operator/user must reconcile wallet history and submit the
actual hash through observe; if no transaction was sent, a separately reviewed
reservation-reset protocol is still needed. Backend reservations survive local
storage loss. Expired/unavailable intents may require operator evidence handling.

This is not an automatic fallback from failed raw signing. Applications explicitly
choose one submission mode per intent. It does not prevent a user independently
sending through their wallet or mixing unsupported clients. A real extension/browser
compatibility test remains outstanding. Local testing uses a sendTransaction-only signer facade over
an ephemeral funded wallet, real HTTP authentication, reservations and two chains.
It verifies each source step sends once, survives reconnect and rejects another
reservation, then finishes the DEX/native payout flow. A targeted SDK test verifies
a lost wallet response cannot trigger a second prompt.

## Destination wallet candidate

`createNativeDestinationRouter` exposes authenticated status and approved steps at
`/native-destination`. Step 0 is an exact settlement-token approval when allowance
is insufficient; step 1 is the pinned exact-input V2 trade. Both are prepared from
the immutable accepted route, verified source/release evidence and current venue
state. The wallet cannot provide transaction targets or calldata.

`createNativeDestinationWalletBackend` and
`submitInjectedNativeDestinationStep` use the same EIP-191 ownership model in a
separate destination namespace. Migration 022 fixes each swap to raw or injected
destination execution and binds the first attempt, exact plan, nonce and hash.
The client rechecks wallet chain/identity after reservation and submits the exact
gas limit and calldata. An uncertain send stops in reconciliation; observation
retrieves the chain-visible transaction and refuses any changed sender, target,
chain, value, calldata or gas limit.

Approval is prepared and finalized before the expiring trade plan is created.
Acceptance reserves the wallet's maximum approval/trade gas across outstanding
fills, separately from custody redemption/payout funding. Route revocation blocks
new sends while allowing the original observed transaction to be reconciled.
Canonical receipt workers still establish DEX finality; wallet observation alone
does not complete the leg.
