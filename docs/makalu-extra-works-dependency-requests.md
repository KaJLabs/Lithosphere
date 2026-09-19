# Makalu extra works — current dependency requests

- **Verified:** 2026-09-19
- **Repository baseline:** `a3c9c7d2a417dd2aa9afd4051cf0fd54b78e0a26`
- **Network:** Makalu EVM chain `700777`; Cosmos chain `lithosphere_700777-2`

These requests contain only the external inputs and approvals still needed. Repository work that is already merged or
deployed is not presented as missing. Do not send credentials, private keys, private inventories, or unredacted
infrastructure evidence through chat or repository issues.

## MultX / Lithoswap — Backend, Bridge, Security, and Operations

The bridge, swap, signer, SDK, API, and UI source exists. The Autha-accepted v0.9.2 API image was published by run
`34965720154`. MultX and Swap remain disabled. Native-settlement PR
[#188](https://github.com/KaJLabs/Lithosphere/pull/188) is a draft after review found unresolved security and
evidence issues.

Required next inputs and approvals:

1. Backend/Bridge owners provide the approved route inventory for Ethereum, BNB Chain, Base, and LITHO: RPC
   providers, finality, bridge/router/pool/token addresses, code hashes, asset backing, executable amounts, limits,
   fees, recovery behavior, and supported directions.
2. Governance owners approve the exact five bridge signers, 3-of-5 threshold, Safe/Timelock/guardian identities,
   deployer, fee payer, caps, liquidity owners, and activation authority. Historical 5-of-7 material is not the
   current candidate policy.
3. Operations privately provide the isolated database/read-only role, signer hosts and custodians, recovery owners,
   deployment host/window, monitoring, retention, rollback, and recovery-drill evidence required by Autha O-01 /
   package O-02.
4. Security reviewers close the PR #188 findings: transaction-attributed DEX evidence, bounded wallet-auth nonce
   retention, consistent quorum documentation, immutable clean-tree packaging, and exact tag-pinned full-rehearsal
   evidence.
5. After independent review, authorize a **disabled** staging rebuild and P-01 isolation/runtime verification.
   Deployment, liquidity, signing, canary, and activation require separate approvals.

Acceptance evidence must identify the exact source commit, image digest, configuration digest, reviewer, run IDs,
and rollback result. No earlier or unreviewed MultX candidate may be relabeled as accepted.

## LEP100 faucet — Client, Treasury, and Faucet Operations

The live faucet exposes native LITHO and ten LEP100 assets, but every LEP100 balance is below the minimum ten-token
claim. On 2026-09-19, WLITHO, LITBTC, JOT, COLLE, and FGPT had zero; LAX, IMAGE, AGII, BLDR, and MUSA had five.
The client deferred this stream on 2026-08-23. Take no funding, key, deployment, or claim action until it is explicitly
reprioritized.

If reactivated, required inputs are:

1. Client confirmation that the deferred stream is active again.
2. Faucet owner confirmation that the exposed funding key was rotated through the approved secret path.
3. VPS owner installation of restricted faucet deploy and rollback wrappers.
4. Treasury-approved reserve and replenishment thresholds for every asset.
5. Named low-balance alert destination and replenishment owner.

Acceptance requires an immutable secured image deployment, one successful claim and retained transaction hash for
each asset, post-claim balances, alert delivery, and rollback evidence.

## Thanos Wallet — Wallet Team

Thanos discovery, prioritization, `window.thanos` fallback, Makalu add/switch, SIWE, replay protection, server
sessions, sign-out, and install fallback are merged and deployed. The supported published extension recorded by the
integration is Chrome version `0.9.33`.

Please provide one acceptance record containing:

1. Tester, date, browser and exact extension version.
2. Fresh install, late EIP-6963 announcement, user rejection, wrong-chain handling, Makalu add/switch, reconnect,
   sign-out, extension restart, and browser restart results.
3. Successful SIWE plus rejected replay and session continuity after an API restart.
4. One approved low-value Makalu transaction hash verified in Lithoscan.
5. Wallet-team approver and explicit acceptance or defect list.

## DNNS — DNNS Owner

Forward `.litho` resolution and forward-verified reverse display are deployed in the explorer. The verified live
interface is the Kamet v0 registry on chain `900523`, not an independently confirmed Makalu registry. Public DNNS
documentation currently describes a different reference architecture and does not provide an authoritative deployed
Makalu interface.

Please provide:

1. Written confirmation that the Kamet v0 registry remains the supported explorer interface, or a reviewed Makalu
   replacement address, ABI, network identity, migration plan, and activation date.
2. Correct public documentation for network IDs, contract addresses, normalization, forward resolution, and reverse
   record rules.
3. One stable reverse-record fixture with expected checksum address and name.
4. Approval of the explorer's no-persistent-cache policy, or bounded positive and negative TTL requirements.
5. DNNS-owner acceptance after forward, reverse, missing, malformed, and RPC-failure smoke tests.

Do not silently substitute an undocumented registry or display an unverified reverse name.

## Quantt — Quantt and Product Owners

The credentials-safe API proxy, explorer page, status endpoint, validation, tests, and OpenAPI paths are deployed but
fail closed. On 2026-09-19, `/api/quantt/status` reported `configured: false`, insights returned HTTP 503,
`research.quantt.at` was reachable, and `dev.quantt.at` failed certificate hostname validation.

Please provide:

1. Approved production and development API base URLs with valid TLS.
2. Authentication scheme and a credential delivered through the approved secret store.
3. Versioned endpoint paths, parameters, response schemas, and representative fixtures.
4. Product decision for the research/analytics fields shown to users.
5. Rate limits, caching, redistribution, attribution, and retention requirements.
6. Quantt and product-owner acceptance criteria and named approvers.

After receipt, Dev Infra will add exact schema validation, configure staging secrets, test reference/error/rate-limit
cases, promote to Makalu, and retain live acceptance evidence.

## Validator infrastructure — scope clarification only

The tracked three-node **mainnet** cleanup, monitoring, dual-recipient signing-state backup, drift checks, alert
ownership, and governance-exception record are complete. Routine monitoring continues.

If the requested work instead means a separate **Makalu validator** cleanup, provide:

1. The authoritative private repository and Makalu inventory path.
2. Node roles and expected topology, without sending secrets or live private snapshots through chat.
3. Desired-state policy for consensus timeouts, RPC exposure, pruning, telemetry, peers, and service ownership.
4. Named Validator Infra, Chain, CAB, rollback, monitoring, and recovery owners.
5. An approved UTC read-only audit window. Any apply/restart window must be approved separately after the audit.

Until that scope is supplied, the completed mainnet work must not be represented as a completed Makalu-node cleanup.

## Developer toolchain — Product, Lithic/VM, Security, and Release Owners

All eight version `0.0.1` command boundaries and three-OS preview builds exist. This is not a public full release.
`lithls`, `lithtest`, `lithsec`, and `lithpkg` remain specification-only; `lithc` does not emit deployable bytecode;
and `lithdev deploy` intentionally refuses deployment.

Required decisions and inputs:

1. Approved full function-body grammar, type/overload/map/return semantics, ABI and VM bytecode target, diagnostics,
   source maps, gas behavior, and conformance vectors.
2. Formatter v0 decision: accept literal-safe whitespace-only behavior or specify AST-canonical formatting.
3. Linter rule/version, configuration, and suppression policy.
4. LSP 3.17/editor support boundary; test syntax/execution/coverage boundary; security threat model/rules; package
   manifest, lock, resolution, integrity, and trust policy.
5. Approved devnet account/network/signing policy for safe `lithdev deploy` simulation and E2E verification.
6. Supported OS/architecture matrix, versioning/compatibility policy, signing identity, release channel, and named
   compiler/security/release approvers.

Only after these decisions are approved should implementation proceed to typed IR/code generation, VM execution,
the four currently specification-only tools, signed/checksummed public archives, and clean-install smoke tests.
