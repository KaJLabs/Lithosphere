# MultX native candidate completion — 2026-09-13

This is a developer candidate. Production MultX remains disabled. Final results
and source inventory are in the validator-infra workspace under
`client-work/MULTX_FINAL_LOCAL_CANDIDATE_2026-09-13/`. Use its results JSON and logs
for current counts; earlier totals describe earlier revisions.

## Implemented locally

- Immutable route approvals, quote snapshots and atomic acceptance. A fixed-fill
  approval can be accepted only once. Acceptance checks source runtime and plan,
  destination chain, EOA parties and unreserved delivery funds. DEX-backed mode
  also checks a verified pool quote, minimum output and native wrapper backing.
- Server-controlled registry and an explicit Express application with quote/source
  mounts and exact CORS origins. Accepted quotes remain pinned to their policy.
  Revocation blocks submission while read-only progress stays available.
- Authenticated source API, wrap/approve/lock plans, raw signing and a separate
  send-only path. Immutable per-intent mode prevents API clients mixing these
  paths. Durable attempts prevent another send after response loss.
- Authenticated destination API and SDK for wallet-owned approval and pinned V2
  trade steps. Immutable mode/attempt/hash bindings prevent raw/injected mixing
  and another send after an uncertain response. The UI exposes explicit actions
  and rejects a wallet on the wrong destination chain.
- SDK quote/accept/status/submission and IndexedDB persistence. Web UI stays hidden
  unless configured. Acceptance and each transaction need separate explicit
  actions. Unresolved reserved attempts offer transaction-hash reconciliation.
- Verified source lock, destination release, final canonical V2 output,
  wrapped-native withdrawal and final native balance credit. Readiness binds the
  accepted policy and source wallet. Payout cannot precede verified redemption
  on a route requiring it.
  Bridge release alone does not complete a native swap.
- Immutable DEX/redemption/payout plans, external signing, identical-byte retry, receipt
  workers, and tracked transactional migrations.
- Disabled multi-origin application configuration validation for the all-direction
  Ethereum/BNB/Base phase and later LITHO addition. It requires exact runtime,
  confirmation and approval records and cannot activate production by itself.

See [NATIVE_QUOTE_API.md](NATIVE_QUOTE_API.md),
[NATIVE_WALLET_API.md](NATIVE_WALLET_API.md) and
[NATIVE_RECOVERY_RUNBOOK.md](NATIVE_RECOVERY_RUNBOOK.md). The production
configuration boundary is in [NATIVE_PRODUCTION_CONFIG.md](NATIVE_PRODUCTION_CONFIG.md).
Clean-environment reproduction is documented in
[REVIEW_ENVIRONMENT.md](REVIEW_ENVIRONMENT.md).

## Scope of evidence

The cross-chain rehearsal uses Hardhat source 31337, Hardhat destination 9005,
PostgreSQL, fixture assets and real local V2 contracts. It demonstrates source
transactions, 3-of-5 release, DEX execution, wrapped-native debit/native custody
credit, native recipient credit, reconnect and lost-response
recovery. The quote/application path is tested separately against the same real
local services. Chromium tests demonstrate IndexedDB reload/concurrent-tab
persistence and authenticated pending-status behavior.

These tests do not prove a production Litho runtime, wallet-extension compatibility,
live liquidity, production custody, independent acceptance or launch readiness.

## Production dependencies

| Dependency | Required owner/input | BrewCodeDev follow-up |
| --- | --- | --- |
| Native route/backing approval | Client/liquidity owner approve each settlement asset, native wrapper, V2 venue, fixed-fill output, fees, backing and replenishment | Configure reviewed route records and verify native redemption against the real wrapper |
| Deployments/funded routes | Deployer/liquidity owner provide approved bridge, wrapper, router, pool and backing records for each direction, amounts, fees, caps, slippage and finality | Verify receipts/runtime, configure exact registries and rehearse each direction |
| Custody/recovery | Five signer operators and named DEX/payout custodians provide accounts, custody references, mTLS/journal evidence, funding and recovery authority | Wire reviewed custody transport/workers and exercise signed-payload/recovery ceremonies |
| Native settlement topology | Approve the settlement asset/backing used to preserve bridge holder and amount for each native pair | Replace/adapt the earlier one-origin deployment topology and verify every configured direction |
| LITHO | Infrastructure provides disposable node matching selected mainnet binary/config; client/LITHO multisig team finalize ownership | Run complete native/precompile/accounting/recovery matrix and finalize deployment evidence |
| Supported wallets | App teams name wallets/platforms and provide staging access/test wallets | Test real extension, WalletConnect and platform interrupted/reconnect flows |
| Independent acceptance | Autha reviews final source, fallback/quorum, quotes, custody, migrations, DEX and recovery together | Remediate findings and regenerate exact source/build evidence |
| Production authorization | Client/governance approve final plan/window, paused deployment, canary and activation separately | Verify Safe → 48-hour Timelock → Bridge and exact 3-of-5 set; run authorized rollout checks |

The `dex-wrapped-native` path trades destination settlement inventory for a pinned
wrapped-native token, verifies its credit, withdraws the approved native output,
verifies wrapped debit/native custody credit and then pays the recipient. Acceptance
reserves delivery gas; verified redemption adds the native output reservation.
The separate `prefunded-fixed-fill` path still requires native output prefunding.
Both use exact-input, one-use approved fixed-fill policies, rather than a general
amount/pricing engine. Pool reserves and backing are rechecked but not escrowed.
Custodians remain trusted; production backing and replenishment need approval.

V3/multihop execution, general Cosmos EVM configuration, Solana and Bitcoin are
additional route scope. Direct V2 fixture tests cannot advertise those routes.
SDK remains private/unpublished; standard production startup does not mount the
native application. No production routes, signing or feature flags were enabled.

The accepted bridge preserves the locked holder and amount. Readiness and new
DEX/payout broadcasts reject a redirect or bridge-side amount conversion, even
if a route policy lists one. Source wallet controls destination settlement; a DEX
custodian cannot sign for it without explicit reviewed authorization. The local
rehearsal uses one wallet across both chains and pre-funded fixture settlement
inventory. Production backing and destination authorization are not established
by that fixture. The current SDK/UI covers source and destination wallet prompts
in the local candidate. Real extension/WalletConnect/mobile staging remains external.
