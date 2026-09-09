# Makalu extra works — living handoff

- **Status:** Active — closing one stream at a time
- **Last verified:** 2026-09-10 PKT (UTC+05:00)
- **Repository:** `KaJLabs/Lithosphere`
- **Default branch inspected:** `origin/main` at `e1b85f64d016d314ab9fc0d9246846988c9385d4`
- **Latest merged workstream change:** PR #175 at `e1b85f64d016d314ab9fc0d9246846988c9385d4`
- **Network in scope:** Makalu testnet, EVM chain ID `700777`, Cosmos chain ID `lithosphere_700777-2`

This is the source of truth for the seven Makalu extra-work streams. Update it whenever code is merged, a release is
published, a live probe changes, an external dependency is received, or an acceptance check is completed. The older
[dependency requests](makalu-extra-works-dependency-requests.md) remain useful as forwardable team requests, while
[mainnet readiness](mainnet-readiness-2026-07-22.md) preserves the broader launch assessment.

## How to read and update this handoff

A stream is not complete merely because its code exists in the working directory.

| Gate | Meaning | Evidence required |
| --- | --- | --- |
| Local | Implementation exists in a developer workspace. | Paths and local verification results. |
| Merged | Reviewed work is tracked on the default branch. | PR or commit reference and required CI results. |
| Released | Immutable, verifiable artifacts were published. | Release URL, version, checksums/signatures, and CI run. |
| Deployed | The intended environment runs the released artifact/configuration. | Deployment record plus live probes. |
| Accepted | Owners and dependent teams completed the stream's acceptance checklist. | Named approver, date, and linked evidence. |

Use these status values:

- `COMPLETE` — every acceptance item is checked and evidence is linked.
- `IN PROGRESS` — safe repository or environment work remains possible.
- `EXTERNAL BLOCKER` — the next required input or authority is held outside this repository.
- `LOCAL ONLY` — material work exists but is not yet merged into `main`.
- `DEFERRED` — the client explicitly accepted the current state and moved the stream out of the active queue.

When changing a status, update the summary, the stream checklist, the verification ledger, and the change log in the
same commit. Never include wallet keys, API keys, validator snapshots, private inventory, or other secrets here.

## Executive snapshot

No stream is marked complete unless every acceptance criterion has evidence. The Lithoscan mainnet cutover is
complete, but it is not one of these seven Makalu extra-work closures. On 2026-08-23 the client accepted the faucet
for now, deferred further MX-02 work, confirmed deployment access, and asked the team to focus on more important
tasks. MX-01 MultX is therefore the active priority. Autha accepted the source and bytecode of the superseding
`multx-audit-candidate-v0.9.2-20260908` tag at commit
`5994f263b9d1fd40c531410d6b23884eade9f5b9`; v0.9.0 itself never received independent written acceptance and must
not be deployed. Corrective PR #173 merged as `b54cb55e62e8be92b8842a8b6485872ec7c9f015`, preserving accepted commit
`5994f263b9d1fd40c531410d6b23884eade9f5b9` and the reviewed #169-#171 stack as ancestors of public `main`. Private
operator-readiness PR #24 merged as `571e96ad22d7dd373b8aa0ef3acfea56cfb2100e`. Production remains blocked by
Autha O-01/package O-02 operational readiness and the outstanding governance, route, signer, canary, and activation
approvals. GitHub records no submitted reviews on PR #173 or private PR #24, so independent acceptance of the
post-v0.9.2 changes and operator package must be evidenced before deployment. MultX, Bridge signing, Swap, and
Faucet remain disabled.

Private development PR #25 merged as `e64f7c7a075acd7799fbe253103ca8ec18ffc655`, preserving reviewed head
`ef4ddb444ffc1006d970e27829bf53a7433872df` as its second parent. Its offline route
evaluator and read-only probes passed both engineering review axes, all 25 tests, and CI run `34395277331` after
fail-closed address and checkpoint hardening. It neither supplies production route inputs nor closes independent
security/operator acceptance. GitHub records no submitted review on the PR, so independent post-merge acceptance
remains required before production use.

The worktree is shared and contains pre-existing changes across several streams. Preserve them, isolate each stream
into a reviewable change, and never bulk-commit the dirty worktree.

| ID | Workstream | Current gate | Status | Immediate next action |
| --- | --- | --- | --- | --- |
| MX-06 | Validator cleanup and safety | All technical, monitoring, recovery, ownership, and governance-exception gates are evidenced | COMPLETE | Continue routine monitoring; any future node change requires a new approved window. |
| MX-02 | LEP100 faucet assets | Current faucet accepted by client; remaining rotation/funding closure postponed | DEFERRED | Take no faucet deployment or funding action until the client reprioritizes it. |
| MX-03 | Thanos Wallet | Repository work merged and deployed; acceptance open | EXTERNAL BLOCKER | Wallet team completes the published-version browser matrix, signed transaction, and approval record. |
| MX-04 | DNNS | Verified explorer hardening merged and deployed; owner acceptance open | EXTERNAL BLOCKER | DNNS owner confirms the supported interface, fixes public docs, nominates a reverse record, and accepts cache policy. |
| MX-05 | Quantt | Assumption-free gates deployed; adapter remains disabled | EXTERNAL BLOCKER | Quantt owner supplies the API contract/credential and fixes or replaces the development TLS endpoint. |
| MX-01 | MultX / Lithoswap | Accepted v0.9.2 lineage and reviewed gates are on public `main`; private readiness and read-only routing preparation merged; independent post-merge acceptance and O-01/package O-02 readiness remain open; mainnet disabled | IN PROGRESS | Obtain independent security/operator acceptance for the post-v0.9.2 and private changes; then supply and approve production inventory/readiness evidence before disabled staging. |
| MX-07 | Developer toolchain | All eight tool boundaries plus locked, checksummed three-OS preview packaging reviewed; four tools remain specification-only and there is no deployable compiler/public release | IN PROGRESS | Obtain approved language/VM semantics and product/release/security acceptance before compiler or public-release work. |

## Sequential closure queue

Only one repository stream is active at a time. An external blocker is recorded and escalated, then work advances
to the next executable stream without pretending the blocked stream is complete.

1. [ ] **MX-01 MultX / Lithoswap** — v0.9.2 source/bytecode accepted; operational readiness, approved deployment inputs, paused deployment, canary, and activation approvals remain.
2. [x] **MX-06 Validator cleanup and safety** — complete; the missing historical PR #17 window artifact is preserved and accepted through private PR #23 rather than reconstructed.
3. [ ] **MX-03 Thanos Wallet** — deployed; waiting on wallet-team acceptance.
4. [ ] **MX-04 DNNS** — deployed; waiting on DNNS-owner acceptance inputs.
5. [ ] **MX-05 Quantt** — deployed but disabled; waiting on Quantt API/TLS/product inputs and acceptance.
6. [ ] **MX-07 Developer toolchain** — separate major compiler/release program.
7. [ ] **MX-02 LEP100 faucet assets** — deferred by the client on 2026-08-23; retain safeguards and make no changes.

## MX-01 — MultX Swap / Lithoswap

**Owners:** Dev Infra + Backend/Bridge team + contract deploy authority + approved liquidity owner

**Current state:** The MultX bridge UI/API, Lithoswap V2 contracts, optional subgraph, and non-AWS signer hardening are
merged through PR #162 at `cb1a0e993f5224a04d712f6dbac8a7accdb57517`. The corresponding v0.9.0 tag did not
receive written independent acceptance and is prohibited from deployment. Autha instead accepted the exact source and
bytecode of annotated tag `multx-audit-candidate-v0.9.2-20260908`, commit
`5994f263b9d1fd40c531410d6b23884eade9f5b9`, after the v0.9.1 and v0.9.2 closure remediations. The supplied acceptance
receipt closes M-03, L-01, L-02, and O-04 and matches all three retained report hashes. Autha O-01 (called package O-02
in the operator handoff) remains open for operational readiness. Corrective PR #173 merged with two parents as
`b54cb55e62e8be92b8842a8b6485872ec7c9f015`; exact accepted commit
`5994f263b9d1fd40c531410d6b23884eade9f5b9` and every reviewed #169-#171 commit are now ancestors of public `main`.
Private preparation PR #24 merged as `571e96ad22d7dd373b8aa0ef3acfea56cfb2100e` and retains disabled rendering
plus fail-closed incomplete-inventory checks. This merges preparation, not the missing production inputs or O-01
operational acceptance. GitHub reports no submitted reviews on PR #173 or private PR #24; this is an open governance
evidence gate and the merge itself must not be treated as independent security or operator acceptance.
Private PR #25 merged as `e64f7c7a075acd7799fbe253103ca8ec18ffc655`, with reviewed head
`ef4ddb444ffc1006d970e27829bf53a7433872df` preserved as its second parent. Its offline evaluator and read-only
V3/native probes pass 25 tests and green CI. The change contains no wallet, signing, submission, deployment, or
activation path. GitHub records no submitted review on PR #25, so independent post-merge acceptance remains open,
as do all authentic production route, asset, liquidity, checkpoint, and operator inputs.
The operator must use only the exact accepted source through an explicitly approved deployment path; no earlier
deployment may be relabeled. Deployment access does not authorize
infrastructure, contracts, signers, liquidity, canary, or feature flags. MultX, Bridge signing, Swap, and Faucet remain
disabled, and no production deployment is recorded.

Completed or evidenced:

- [x] MultX bridge UI and same-origin API proxy are present.
- [x] Makalu/Kamet bridge addresses and the LEP100 token map are encoded.
- [x] Lock, status/signature polling, history, and release/claim paths exist.
- [x] Local Lithoswap V2 factory/router/pair and deployment/liquidity/E2E scripts exist.
- [x] Nine contract tests pass, including four Lithoswap tests (2026-08-03).
- [x] Live config reports `bridge: true` (2026-08-03).
- [x] PR #75's paused v0.5 testnet redeployment procedure was updated to current `main`, review-hardened, passed all
      checks plus 84 local Hardhat tests, and merged without executing a deployment (2026-08-15).
- [x] PR #78 was reviewed and formally blocked from merge pending a provider-neutral, non-AWS signer architecture.
- [x] Live config was reverified as `bridge: true`, `swap: false`; both swap routes show unavailable (2026-08-15).
- [x] PR #68 was updated to current `main`; unsafe deployment defaults were removed and explicit chain, controller,
      bytecode, manifest, preflight, and value-moving confirmation gates were added (2026-08-16).
- [x] The reviewed DEX slice passed 28 full Hardhat tests, 23 focused DEX/configuration tests, nine E2E checks,
      strict TypeScript validation, and Slither with zero detectors (2026-08-16).
- [x] Conflicting July UI PR #69 was verified as superseded by the newer fail-closed implementation on `main` and
      closed without merge (2026-08-16).
- [x] PR #68 passed all repository checks and merged by `bachal-mb` as
      `07b37969f00d97eaca17794c31a83546b60a1940`; no deployment or funding occurred (2026-08-16).
- [x] AWS-specific PR #78 was reverified unchanged and closed as rejected architecture; no signer deployment or
      production configuration change occurred (2026-08-16).
- [x] Local provider-neutral signer review added strict policy/RPC validation, journal-before-sign semantics, unique
      quorum identities, serialized polling, configured-signer-only counts, and explicit multichain evidence gates.
- [x] Eleven signer tests, eighteen API tests, and eighty-eight bridge-contract tests pass; all three production
      dependency audits report zero vulnerabilities locally (2026-08-16).
- [x] PR #93 passed all repository checks and merged by `bachal-mb` as
      `60f3f7bb151e9e2be48632468212e602220f40f4`; no deployment or key access occurred (2026-08-16).
- [x] The optional V2 subgraph merged in PR #71; its dependency advisories were remediated in PR #128 (2026-08-23
      verification of `main`).
- [x] PR #129 merged the Autha v0.8 engineering remediations and the exact commit is tagged
      `multx-audit-candidate-v0.8.1-20260822` (2026-08-22).
- [x] Clean-checkout verification on that tag passed 112 contract, 32 API, and 23 signer tests (2026-08-23).
- [x] Client confirmed deployment access is available; no credential was printed or committed (2026-08-23).
- [x] PR #150 merged the H-01/H-02/H-03/M-01 engineering closure at
      `f67ecfb1d0b3078e53c2eb39d6ba88e0ae373bdd`; its exact-commit MultX source gates passed (2026-09-02).
- [x] Clean-checkout reproduction of the v0.8.2 tag passed 118 contract, 37 API, and 23 signer tests; production
      dependency gates reported no high or critical findings (2026-09-05).
- [x] Published the v0.8.2 Autha focused-closure prerelease with exact source, SHA-256 manifest, independent bytecode
      evidence, test/audit logs, and PR/workflow evidence (2026-09-05).
- [x] Reverified LITHO mainnet `/api/config`: EVM chain ID 9005 and `faucet: false`, `bridge: false`, `swap: false`
      (2026-09-05).
- [x] Prepared the non-AWS signer review candidate: removed AWS runtime/dependencies, enforced direct production mTLS,
      owner-only mounted keys and journals, file-mounted policy, and legacy-variable rejection; 37 API and 24 signer
      tests plus both container builds pass (2026-09-05).
- [x] PR #162 merged the non-AWS signer candidate as
      `cb1a0e993f5224a04d712f6dbac8a7accdb57517`, and annotated tag
      `multx-audit-candidate-v0.9.0-20260905` was published with immutable source/evidence hashes (2026-09-05).
- [x] Recorded that v0.9.0 never received written independent acceptance and must not be deployed; its open tracker
      PR #164 is historical/stale evidence, not a deployment approval (2026-09-09).
- [x] Verified annotated tag `multx-audit-candidate-v0.9.2-20260908` resolves to exact commit
      `5994f263b9d1fd40c531410d6b23884eade9f5b9` (2026-09-09).
- [x] Verified the supplied Autha acceptance receipt binds v0.9.2 to source SHA-256
      `f40e76603d5dff8d8a283a8d426786c375e3e96bd20aea73de516547c50dfecc` and bytecode-evidence SHA-256
      `6f1ac61bb38939de0ee01db845996ca15cfc7eda6a20ee817d6848562a304bd2`; all three retained report hashes match
      the receipt. M-03, L-01, L-02, and O-04 are accepted closed (2026-09-09).
- [x] Reviewed PRs #168-#171 against repository standards and their stated specifications; all public code checks
      passed. Added an automated API/signer source-evidence parity test, with 60 API, 43 signer (34 pass and nine
      Windows-only skips), and 153 contract tests passing locally (2026-09-09).
- [x] Reviewed private operator-readiness PR #24, fixed its recovery-owner separation gate to require seven normalized
      distinct recovery owners and per-signer custodian/recovery independence, and passed 32 tests with three
      platform-specific skips plus Linux CI (2026-09-09).
- [x] Merged corrective PR #173 with the accepted v0.9.2 and reviewed #169-#171 commits preserved as ancestors of
      public `main`; merged private readiness preparation PR #24 with its recovery-owner fix (2026-09-09).
- [x] Reviewed private routing PR #25 against standards and specification, fixed malformed EVM identity and JSON-RPC
      checkpoint acceptance, passed 25 tests plus CI run `34395277331`, and merged it as
      `e64f7c7a075acd7799fbe253103ca8ec18ffc655` without deployment or activation (2026-09-10).
- [x] Verified the newer disposable-node packages cover 34-transaction Cosmos bank/EVM/ERC-20 accounting, finite
      maximum allowance, native approval expiry, exact simulated cap boundaries, recipient callback behavior, and
      hostile-token reentrancy rollback. These are scoped local results, not production acceptance (2026-09-10).

Remaining actions:

- [x] Isolate, review, and merge the V2 contracts, release-gated deployment/liquidity scripts, and tests in PR #68.
- [x] Review and merge the optional V2 subgraph and remediate its dependency advisories (PRs #71 and #128).
- [x] Record the explicit project decision that AWS is not used; no AWS connectivity or deployment is authorized.
- [x] Merge the provider-neutral signer/API/bridge review hardening in PR #93.
- [x] Regenerate and publish the exact v0.8.2 focused-closure evidence bundle.
- [x] Obtain Autha's written source/bytecode acceptance. Acceptance is bound only to the superseding v0.9.2 tag and
      commit `5994f263b9d1fd40c531410d6b23884eade9f5b9`; it does not approve v0.9.0.
- [x] Remove the legacy AWS runtime/dependencies, archive the rejected proposal, and update active mainnet material to
      the approved non-AWS signer architecture in a review candidate.
- [x] Merge the non-AWS candidate and obtain independent source/bytecode review through the exact superseding v0.9.2
      tag. Preserve v0.9.0 only as rejected historical evidence.
- [ ] Complete Autha O-01/package O-02 operational readiness: approved seven-host inventory and network topology;
      independent signer custodians and recovery owners; governance, deployer, fee-payer, asset, route, cap, finality,
      and independent-RPC approvals; source-pinned production image publication/provenance; host/key/PKI hardening;
      isolated database/coordinator recovery; disabled staging; per-signer recovery; monitoring, alert, and rollback
      drills.
- [x] Merge corrective PR #173 using a **merge commit only**. Its second parent contains exact accepted commit
      `5994f263b9d1fd40c531410d6b23884eade9f5b9` and the reviewed #169-#171 stack; squashing or rebasing would again
      discard the accepted ancestry. Merged as `b54cb55e62e8be92b8842a8b6485872ec7c9f015`.
- [x] Merge private operator-readiness PR #24. Its rendered configurations
      remain disabled and incomplete production inventory must continue to fail closed.
- [ ] Obtain and record independent security/operator acceptance for the post-v0.9.2 mainline changes and private
      operator package. GitHub currently records no submitted reviews on PR #173 or private PR #24.
- [ ] Obtain and record independent post-merge security/operator acceptance for private PR #25. GitHub records no
      submitted review, so the merge alone does not approve its use in production.
- [ ] After 2026-09-10 12:29:01 UTC, complete the retained disposable-node real elapsed-time native cap rollover once,
      preserve the result, and obtain independent acceptance. Do not rerun setup or retry after partial submission.
- [ ] Verify production indexer ingestion/reorg/double-credit behavior against approved disabled staging. Public PRs
      #170-#171 cover canonical-range and source-evidence logic, but do not constitute a production indexer run.
- [ ] Modernize or explicitly disposition the MultX deployment/test toolchain's transitive audit findings before
      using it as a long-lived privileged runner (full local audit: 3 critical, 14 high; production-only audit: 0).
- [ ] Obtain Backend/Bridge confirmation of the route contract, token map, relayer/claim behavior, and supported
      source/destination chains.
- [ ] Complete contract security review and record deployer, admin/ownership, pause, upgradeability, and emergency
      procedures.
- [ ] After all readiness approvals, deploy fresh replacement contracts paused on each approved chain and record
      addresses, creation transaction hashes, bytecode hashes, governance chain, and artifact version. Do not relabel
      any earlier deployment.
- [ ] Seed only approved bounded liquidity and record token sources and initial pool ratios.
- [ ] Set the released explorer's swap-router configuration and enable swap through the controlled promotion flow.
- [ ] Run small-value same-chain swaps in both directions, remove liquidity, and reconcile balances.
- [ ] Run cross-chain lock/release tests in every approved direction, including retry, failure, and reversibility.
- [ ] Obtain Backend/Bridge and contract-owner acceptance.

Acceptance criteria:

- [ ] `bridge: true` and `swap: true` are intentional and tied to a reviewed release.
- [ ] Same-chain quote, approval, swap, slippage rejection, and liquidity removal pass live.
- [ ] Cross-chain lock, signatures, release, duplicate-claim rejection, and history pass live.
- [ ] Contract addresses, liquidity bounds, rollback/disable procedure, and approvers are recorded.

Evidence:

- `Makalu/explorer/lib/bridge.ts`
- `Makalu/explorer/lib/crossSwap.ts`
- `Makalu/explorer/pages/bridge.tsx`
- `Makalu/explorer/pages/swap.tsx`
- `Makalu/explorer/pages/cross-swap.tsx`
- `Makalu/contracts/src/dex/`
- `Makalu/contracts/scripts/deploy-dex.ts`
- `Makalu/contracts/scripts/seed-dex-liquidity.ts`
- `Makalu/contracts/scripts/dex-e2e.ts`
- `docs/dex-team-request-lithoswap.md`
- `MultX/docs/V05_TESTNET_REDEPLOYMENT.md`
- `MultX/docs/VPS_SIGNER_ARCHITECTURE.md`
- `MultX/signer/OPERATOR_RUNBOOK.md`
- Review PR: `https://github.com/KaJLabs/Lithosphere/pull/75`
- Lithoswap V2 PR: `https://github.com/KaJLabs/Lithosphere/pull/68`
- Blocked AWS proposal: `https://github.com/KaJLabs/Lithosphere/pull/78`
- Provider-neutral signer hardening: `https://github.com/KaJLabs/Lithosphere/pull/93`
- Non-AWS signer architecture: `MultX/docs/VPS_SIGNER_ARCHITECTURE.md`
- Non-AWS signer source manifest: `MultX/docs/audit/AUDIT_SIGNER_SOURCE_MANIFEST_2026-09-05.md`
- Autha v0.8.2 remediation PR: `https://github.com/KaJLabs/Lithosphere/pull/150`
- Exact-commit MultX source gates: `https://github.com/KaJLabs/Lithosphere/actions/runs/33654850127`
- v0.8.2 focused-closure prerelease:
  `https://github.com/KaJLabs/Lithosphere/releases/tag/multx-audit-candidate-v0.8.2-20260902`
- v0.8.2 source archive SHA-256: `8f9c01c6aa176788d271c7edcce7dd7d2b6c0a82ffcba4470800da5d4269456c`
- v0.8.2 evidence archive SHA-256: `2b35ed93dc2efc9af289bf15ccd6c3ee33aad0467b27b03634c91e1bdc62858d`
- Rejected v0.9.0 tag (must not deploy):
  `https://github.com/KaJLabs/Lithosphere/releases/tag/multx-audit-candidate-v0.9.0-20260905`
- Accepted v0.9.2 annotated tag:
  `https://github.com/KaJLabs/Lithosphere/tree/multx-audit-candidate-v0.9.2-20260908`
- v0.9.2 exact commit: `5994f263b9d1fd40c531410d6b23884eade9f5b9`
- v0.9.2 accepted source SHA-256: `f40e76603d5dff8d8a283a8d426786c375e3e96bd20aea73de516547c50dfecc`
- v0.9.2 accepted bytecode-evidence SHA-256:
  `6f1ac61bb38939de0ee01db845996ca15cfc7eda6a20ee817d6848562a304bd2`
- Accepted-source squash merge: `https://github.com/KaJLabs/Lithosphere/pull/168`
- Stacked reviewed PRs (not independently landed on `main`):
  `https://github.com/KaJLabs/Lithosphere/pull/169`,
  `https://github.com/KaJLabs/Lithosphere/pull/170`, and
  `https://github.com/KaJLabs/Lithosphere/pull/171`
- Mainline lineage correction: `https://github.com/KaJLabs/Lithosphere/pull/173`, merge
  `b54cb55e62e8be92b8842a8b6485872ec7c9f015`
- Private operator-readiness preparation: `https://github.com/KaJLabs/Lithosphere-Production-Infra/pull/24`, merge
  `571e96ad22d7dd373b8aa0ef3acfea56cfb2100e`
- Private quote-only routing and read-only probes: `https://github.com/KaJLabs/Lithosphere-Production-Infra/pull/25`,
  head `ef4ddb444ffc1006d970e27829bf53a7433872df`, merge
  `e64f7c7a075acd7799fbe253103ca8ec18ffc655`, CI run `34395277331`
- Live probes: `https://makalu.litho.ai/api/config`, `https://makalu.litho.ai/swap`,
  `https://makalu.litho.ai/cross-swap`, `https://lithoscan.ai/api/config`

## MX-02 — LEP100 Lithic-native assets on the faucet

**Owners:** Dev Infra + faucet deploy owner + token treasury/contract owners

**Current state:** The live faucet exposes native LITHO plus ten LEP100 assets. Native LITHO is funded. Every LEP100
asset is below its minimum ten-token claim: WLITHO, LITBTC, JOT, COLLE, and FGPT have zero; LAX, IMAGE, AGII, BLDR,
and MUSA have five. Balance-aware, fail-closed API and explorer behavior passed seven focused tests plus a strict
TypeScript build. PR #80 merged those safeguards on 2026-08-14. PR #82 then merged secured faucet image publishing,
pre-publication vulnerability gating, immutable image waiting, and source-controlled deploy/rollback candidates as
`f6303f9d39f3c8075284dc73ecb65d4b3556e7eb`. The merged faucet image passed Trivy,
signing, provenance, and SBOM generation at digest
`sha256:34391877a9029461dfc261ce1ed0704b791d19f9065c0367a297952e49be12d8`. Production was intentionally not
deployed: faucet releases are manual pending rotation of the exposed funding key and protected-wrapper activation.
Treasury replenishment is also required before live token claims can pass. The former setup guide was removed because
it referenced a retired hosting path, assumed an unapproved funding amount, and instructed direct privileged edits;
the replacement runbook is VPS-only, wrapper-bound, and requires explicit old/new address and per-asset approvals.
On 2026-08-23 the client accepted the current faucet for now and explicitly moved the team to higher-priority work.
The remaining checklist is retained for traceability, but it is deferred and must not trigger a deployment, wallet
rotation, drain, funding transfer, or secret change without a new client priority and the existing approvals.

Completed or evidenced:

- [x] Ten LEP100 assets and their Makalu contract addresses are configured.
- [x] The live faucet reports asset balances.
- [x] FGPT/MUSA metadata was corrected against the on-chain contracts.
- [x] Faucet TypeScript build passed on 2026-08-03.
- [x] Health metadata derives per-asset availability, claimable amounts, minimum claim, and exact shortfall locally.
- [x] Drip rejects underfunded assets before cooldown mutation or transfer, including a fail-closed balance-read path.
- [x] Explorer disables unavailable assets and presents their funding shortfall locally.
- [x] Seven focused availability/route tests and the strict faucet build pass (2026-08-14).
- [x] Faucet image passes the pre-publication CRITICAL Trivy gate and is signed, provenance-attested, and accompanied
      by an SBOM (2026-08-14).
- [x] Replaced the obsolete direct-access faucet setup instructions with an approval-gated wallet-rotation,
      restricted-wrapper, immutable-image, smoke-test, alert, and rollback runbook (2026-08-16).

Remaining actions:

- [x] Isolate, review, and merge `availability.ts` plus the drip/health/UI behavior in PR #80 (2026-08-14).
- [x] Add focused tests for zero balance, below-minimum balance, balance-read failure, malformed balance, and a
      successful funded claim path.
- [x] Extend the immutable GHCR publisher to build/sign/attest `lithosphere-faucet` on faucet changes (PR #82).
- [ ] Rotate the exposed faucet funding key through the server secret-management path before deployment; do not
      transmit the replacement key through chat or repository files.
- [ ] Have the VPS owner update the restricted deploy and rollback wrappers to recreate/restore the faucet container.
- [ ] Add and activate a separate manual faucet release workflow with immutable image, schema, and rollback gates
      after the funding key is rotated and the dedicated restricted wrappers are installed.
- [ ] Deploy the faucet/API/explorer release and verify unavailable assets are clearly disabled.
- [ ] Obtain approved replenishment amounts and fund every token above its operational reserve threshold.
- [ ] Execute one live claim for every asset and retain transaction hashes.
- [ ] Confirm low-balance alerts fire before an asset falls below its minimum claim.

Acceptance criteria:

- [ ] Health and claim endpoints fail closed per asset without presenting the whole faucet as healthy when claims
      cannot be served.
- [ ] All ten assets have an approved reserve and can satisfy at least one minimum claim.
- [ ] A successful live claim and post-claim balance are recorded for every asset.
- [ ] Alert routing and the replenishment owner are documented.

Evidence:

- `Makalu/faucet/src/services/availability.ts`
- `Makalu/faucet/src/services/availability.test.ts`
- `Makalu/faucet/src/services/wallet.ts`
- `Makalu/faucet/src/routes/drip.ts`
- `Makalu/faucet/src/routes/drip.test.ts`
- `Makalu/faucet/src/routes/health.ts`
- `docs/FAUCET_SETUP_INSTRUCTIONS.md`
- Live probe: `https://makalu.litho.ai/api/faucet/info`
- Isolated implementation commit: `c83910f`
- Review PR: `https://github.com/KaJLabs/Lithosphere/pull/80`
- Merge commit: `ef5092812cddc591836657cea6197f8aa2f46fac`
- Image/deployment pipeline PR: `https://github.com/KaJLabs/Lithosphere/pull/82`
- Pipeline merge commit: `f6303f9d39f3c8075284dc73ecb65d4b3556e7eb`
- Merged image run: `https://github.com/KaJLabs/Lithosphere/actions/runs/31814888627`
- Verified faucet image digest: `sha256:34391877a9029461dfc261ce1ed0704b791d19f9065c0367a297952e49be12d8`
- Live post-merge probe at 2026-08-14 15:24 PKT: previous payload still active (`ready` and per-asset `available`
  absent).

## MX-03 — Thanos Wallet integration

**Owners:** Dev Infra + Thanos Wallet team

**Current state:** Thanos is integrated as the EIP-6963 injected provider `fi.thanos.wallet`, with the extension's
official `window.thanos` surface as a fallback. Direct discovery, network addition/switching, SIWE message signing,
signature normalization, nonce verification, replay protection, bearer sessions, and disconnect behavior are
implemented. PR #83 merged the discovery hardening and acceptance record as
`6ded419ca7034f9ded110255dd1a2683d3399029`. The published Chrome version and production secret gate are verified.
Its first deployment was rolled back safely because the core explorer health gate incorrectly required the paused
MX-02 faucet schema. PR #84 isolated the core deployment, and run `31822244365` attempt 2 deployed release
`4fdb3ca5a4bcb0d24978189ce158028ae6247984` successfully without touching the faucet. Only wallet-team browser
acceptance and a low-value signed transaction remain open.

Completed or evidenced:

- [x] Thanos EIP-6963 discovery and prioritization are merged.
- [x] Direct “Sign in with Thanos” flow and install fallback are merged.
- [x] Makalu chain enforcement and add/switch-network flow exist.
- [x] Server-validated nonce/SIWE/session flow with replay protection exists.
- [x] API auth tests and explorer wallet/auth tests pass (2026-08-03).
- [x] Published Chrome version `0.9.33` was verified on 2026-08-14; its source commit `c352a5cfef22` announces
      EIP-6963 with RDNS `fi.thanos.wallet`, exposes `window.thanos`, and supports EIP-1193 signing.
- [x] The production Makalu API uses a present, non-placeholder `AUTH_SESSION_SECRET` of at least 32 characters;
      the value was not exposed (2026-08-14).
- [x] Automated coverage includes late EIP-6963 announcement and the official `window.thanos` fallback.
- [x] PR #83 passed all 15 required/reporting checks and merged as `6ded419ca7034f9ded110255dd1a2683d3399029`.
- [x] PR #84 isolated core deployment from the faucet; run `31822244365` attempt 2 passed the public gate and deployed
      release `4fdb3ca5a4bcb0d24978189ce158028ae6247984` (2026-08-14).

Remaining actions:

- [ ] Wallet team tests published extension version `0.9.33` in Chrome/Chromium and records browser/version evidence.
- [ ] Test fresh install, late EIP-6963 announcement, user rejection, wrong chain, network switch, reconnect, sign-out,
      extension restart, and browser restart.
- [ ] Submit an approved low-value signed transaction and verify it in Lithoscan.
- [ ] Obtain Wallet team acceptance.

Acceptance criteria:

- [ ] Thanos connects without falling back to another injected wallet.
- [ ] SIWE succeeds, replay is rejected, and the session survives an API restart.
- [ ] Makalu add/switch and one signed transaction succeed on the supported extension release.
- [ ] Wallet team approver, extension version, test date, and evidence are recorded.

Evidence:

- `Makalu/explorer/lib/thanos.ts`
- `Makalu/explorer/components/ThanosSignIn.tsx`
- `Makalu/explorer/context/WalletContext.tsx`
- `Makalu/api/src/__tests__/thanos-auth.test.ts`
- `Makalu/explorer/test/auth.test.ts`
- `Makalu/explorer/test/walletNetwork.test.ts`
- `docs/thanos-wallet-acceptance.md`
- `https://github.com/KaJLabs/Lithosphere/pull/83`
- `https://github.com/KaJLabs/Lithosphere/pull/84`
- `https://github.com/KaJLabs/Lithosphere/actions/runs/31819790372`
- `https://github.com/KaJLabs/Lithosphere/actions/runs/31822244365`

## MX-04 — DNNS integration

**Owners:** Dev Infra + DNNS team

**Current state:** Forward `.litho` search and reverse address display are merged and deployed. Direct source and
on-chain verification identified the supported deployed v0 as a Kamet-only (`900523`) registry at
`0x316dc15bF377F7187e5BE38BA19e673Ca823d1ab` through `https://rpc-3.litho.ai`. All nine reserved names resolve to
the deployment address. PR #86 merged and deployed hardening that removes process-lifetime negative caching,
separates an RPC failure
from a missing record, enforces the deployed 2LD normalization rules, and forward-verifies reverse names before
display. Protected run `31826844798` passed the deployment and public health gates for release
`c5448da8c617cf06083f9c08be7e08bd1b5cb6b2`. The public documentation describes a different Makalu-oriented
reference architecture without deployed addresses, and the deployed v0 currently has no reverse record for the
shared reserved-name address. All executable repository work is complete; the stream is now externally blocked.

Completed or evidenced:

- [x] Namehash, `.litho` detection, forward resolution, and reverse resolution exist.
- [x] Explorer search navigates resolved names to address pages.
- [x] Address pages can display reverse-resolved names.
- [x] Five DNNS tests pass (2026-08-03).
- [x] Deployment metadata and contract bytecode were independently verified against Kamet chain ID `900523`.
- [x] All nine source-controlled reserved names resolve live to
      `0xE9267bDf7084815B0754545049AE45FE744Aefa8` (2026-08-14).
- [x] Deployed label rules were traced to the names portal and encoded in explorer normalization tests.
- [x] Process-lifetime positive/negative caching was removed so new records can appear without a process restart.
- [x] RPC failures are distinguished from unset records, and reverse results require forward verification.
- [x] PR #86 passed all checks and merged as `c5448da8c617cf06083f9c08be7e08bd1b5cb6b2` (2026-08-14).
- [x] Protected deployment run `31826844798` passed image, deploy, and public health gates (2026-08-14).
- [x] Public release SHA, home, blocks, shipped validation text, and two live forward records were reverified after
      deployment.

Remaining actions:

- [ ] DNNS owner confirms the verified Kamet v0 deployment remains the supported explorer interface or provides a
      reviewed replacement deployment and migration date.
- [ ] DNNS owner updates public documentation with authoritative network IDs, contract addresses, normalization,
      and reverse-record rules; current public reference material conflicts with deployed v0.
- [ ] DNNS owner configures or nominates one stable reverse record and supplies its expected address/name pair.
- [ ] Agree on the no-persistent-cache policy or provide bounded positive/negative TTL requirements.
- [ ] Smoke-test forward, reverse, missing/malformed names, and RPC failure from the newly deployed explorer release.
- [ ] Obtain DNNS-team acceptance.

Acceptance criteria:

- [ ] Two known names resolve forward to their expected checksum addresses in the live explorer.
- [ ] At least one expected reverse record renders on a live address page.
- [ ] Missing names, resolver failures, normalization, and cache refresh behavior are documented and tested.
- [ ] DNNS approver, date, and evidence are recorded.

Evidence:

- `Makalu/explorer/lib/dnns.ts`
- `Makalu/explorer/components/DnnsName.tsx`
- `Makalu/explorer/components/SearchBar.tsx`
- `Makalu/explorer/test/dnns.test.tsx`
- `Makalu/explorer/test/dnns-resolver.test.ts`
- `docs/dnns-acceptance.md`
- Public DNNS documentation: `https://dnns.litho.ai/`
- Review PR: `https://github.com/KaJLabs/Lithosphere/pull/86`
- Deployment run: `https://github.com/KaJLabs/Lithosphere/actions/runs/31826844798`

## MX-05 — Quantt integration

**Owners:** Dev Infra + Quantt team + product owner

**Current state:** The credentials-safe server proxy, explorer page, provisional normalizer, tests, and OpenAPI paths
are deployed. The live status endpoint reports `configured: false`. The research site returns HTTP 200.
`dev.quantt.at` resolves externally, but presents a certificate for `quantts.ai` names and fails hostname
verification. The similarly named `dev.quantts.ai` is reachable, but is not an approved substitute. Repository
hardening removed guessed auth/path defaults and added the previously missing acceptance runbook. The adapter
must remain fail-closed until the exact owner-approved contract and secret-manager credential are available. PR #88
merged and protected run `31828985116` deployed the assumption-free gates as release
`c01ec48472544270ec0716483e5a07bba947b079`; all executable work is now externally blocked.

Completed or evidenced:

- [x] HTTPS and `quantt.at` hostname allow-listing exist.
- [x] Server-only authentication, symbol validation, bounded timeouts, and sanitized upstream errors exist.
- [x] `/api/quantt/status`, `/api/quantt/insights`, `/quantt`, tests, and OpenAPI documentation exist.
- [x] Live `/api/quantt/status` returns HTTP 200 and safely reports unconfigured (2026-08-03).
- [x] Live status, research portal, developer DNS, and the mismatched certificate subject/SANs were reverified on
      2026-08-14 without bypassing TLS for acceptance.
- [x] The unapproved `quantts.ai` lookalike was recorded but not substituted for the requested domain.
- [x] Activation now requires an explicit auth scheme and insights path instead of guessed defaults locally.
- [x] Five focused Quantt tests, all 164 API tests, and the strict TypeScript build pass locally (2026-08-14).
- [x] PR #88 passed all checks and merged as `c01ec48472544270ec0716483e5a07bba947b079` (2026-08-14).
- [x] Protected deployment run `31828985116` passed image, deploy, and public health gates (2026-08-14).
- [x] Public release SHA, disabled status, null API origin, page HTTP 200, and insights HTTP 503 were reverified after
      deployment.

External inputs required:

- [ ] Production and development API base URLs.
- [ ] Authentication scheme and a secret-store-delivered credential.
- [ ] Approved endpoint paths, request parameters, and versioned response schemas.
- [ ] Product decision on which analytics/research data is displayed.
- [ ] Rate limits, cache/redistribution policy, attribution, and retention guidance.
- [ ] Correct TLS certificate for `dev.quantt.at` or a replacement supported hostname.

Remaining actions after inputs arrive:

- [ ] Add schema validation and contract fixtures for approved responses.
- [ ] Configure secrets in staging without placing keys in client bundles, files, or logs.
- [ ] Validate reference symbols, empty results, rate limits, timeouts, and upstream failures.
- [ ] Promote configuration to Makalu and monitor error/cache behavior.
- [ ] Obtain Quantt and product-owner acceptance.

Acceptance criteria:

- [ ] Live status reports configured without exposing secrets.
- [ ] Approved reference responses render correctly and malformed responses fail closed.
- [ ] TLS, authentication, rate limiting, caching, retention, and attribution meet the Quantt contract.
- [ ] Quantt and product approvers, schema/version, date, and evidence are recorded.

Evidence:

- `Makalu/api/src/quantt.ts`
- `Makalu/api/src/__tests__/quantt.test.ts`
- `Makalu/explorer/lib/quantt.ts`
- `Makalu/explorer/pages/quantt.tsx`
- `docs/integrations/quantt.md`
- Live probe: `https://makalu.litho.ai/api/quantt/status`
- Public sites: `https://research.quantt.at/`, `https://dev.quantt.at/`
- Review PR: `https://github.com/KaJLabs/Lithosphere/pull/88`
- Deployment run: `https://github.com/KaJLabs/Lithosphere/actions/runs/31828985116`

## MX-06 — Validator infrastructure cleanup

**Owners:** Validator Infra team + Chain team + CAB/change approver; Dev Infra owns the audit helper

**Current state:** The audit helper and rolling-cleanup material still require the authoritative private inventory and
an approved cleanup window. The mainnet safety foundation is active: restricted `lithomonitor` access is installed on
the validator and both sentries, pinned host fingerprints were confirmed, and scheduled chain progression checks are
passing. PR #139 upgraded the signing-state control to two independent recipients. Protected run `33489075548`
captured and independently encrypted height `5,776,198`; the retained manifest contains two distinct recipient
fingerprints and matching ciphertext hashes. Both custodians independently decrypted and content-validated their
ciphertext offline without writing plaintext key files locally or sharing/uploading recovery private keys. Backup
incident #74 is closed. The first protected scheduled recurrence, run `33505116681`, also passed on merged commit
`9d09afa72d865b9c957396d386e0a50a4e282245` at signed height `5,802,670`; its two ciphertext hashes match the
manifest and its recipient fingerprints are distinct. No restore was installed and no second signer was started.
The activation run was an approved manual dispatch; the later scheduled run establishes recurring dual-recipient
operation while retaining the protected environment approval gate.
On 2026-09-01 the client identified `KaJLabs/Lithosphere-Production-Infra` and
`ansible/inventory/mainnet-9005/`, and approved only an Ansible `--check --diff` run. Repository admin access was
verified. Private PR #16 subsequently merged as
`339e9a9acb0b3e10bc0e0ea8ae1d0213f04925c4`. It publishes the strict-host-key inventory and the exact check-only
playbook `ansible/playbooks/mainnet-9005-drift-check.yml`, which refuses to run outside Ansible check mode. Both sentry
host records now bind raw CometBFT RPC to `tcp://127.0.0.1:27057`, resolving the earlier public-RPC policy conflict in
desired state. The older merged detector in `BrewCodeDev/lithosphere-dev-infra` targets obsolete AWS inventory and
disables SSH host-key verification, so it is not authorized or suitable for current bare-metal mainnet.
On 2026-09-02 KaJ Labs assigned Litho Agent (`@lithoagent`) as Validator Infra, Chain, and CAB approver. Before a
duplicate check was run, private-infra PR #17 was found already merged as
`a0c76357ade9cee8cb0d3bc5014ca7130453a324`. Its closure record says the other team completed the check-only baseline,
corrected the Nginx upstream and both sentry raw RPC bindings one at a time in a separately approved window, and
finished with `changed=0`, `unreachable=0`, and `failed=0` on all three nodes. It records no validator restart or
chain-state change. Independent public probes then confirmed Cosmos/REST `lithosphere_9005-1`, EVM `0x232d`, height
progression `5,960,798` to `5,960,804`, `catching_up=false`, and no reachable direct HTTP service on either sentry's
port `27057`. The exact UTC maintenance approval/window is not linked in the closure record, so that evidence remains
open; no duplicate Ansible or SSH operation was performed. Public PR #149 subsequently recorded Litho Agent
 (`@lithoagent`) as primary responder, `@Jkasr` as independent backup responder, and Telegram through
 `@LITHO_Moniter_bot` as the approved alert channel. Environment-scoped Telegram secrets are configured, and controlled
 test run `33635711860` passed the three-node health check and Telegram delivery step. Both responders independently
 confirmed receipt on 2026-09-02. The `litho-mainnet-monitoring` environment currently
 has no reviewer protection rules because adding them there would block every unattended five-minute monitor. A
 separate secret-free `litho-mainnet-monitoring-test` approval environment now requires `@lithoagent` or `@Jkasr`
 review and prevents self-review. Merged PR #153 separates controlled-test approval from automatic incident delivery so
 that protection can be used without delaying real alerts. Private-infra PR #18 merged the daily 03:17 UTC check-only
 drift workflow, forced-command control-host boundary, strict sanitization, and 14-day report retention. Follow-up PR
 #19 records the approved `vps2` control host, schedule, retention, and Litho Agent (`@lithoagent`) as rollback owner.
 A dedicated forced-command key and pinned control-host record are configured in `litho-mainnet-drift`; no validator
 private key is stored in GitHub. Manual workflow run `33688898843` passed on private-infra commit
 `d678eacd8eded1afb8135d6999111720bd8f3ae9` with all three hosts reachable and zero changed or failed tasks. Arbitrary
 SSH command execution was independently denied. The first two automatic attempts exposed a reviewed-commit pinning
 defect and failed closed. Private PR #22 corrected that defect. Scheduled run `33953350571` then passed on current
 private `main`; its strict sanitized artifact reports `result: clean`, exactly three hosts, and `changed=0`,
 `unreachable=0`, `failed=0`. Protected post-merge Telegram test run `33671700384` was approved by `@lithoagent` and
 passed the health, approval, and delivery jobs on 2026-09-05. Private PR #23 preserves the missing original PR #17
 UTC window artifact as a governance exception. The project representative confirmed that the named owners privately
 approved the exception and directed `BrewCodeDev` to merge it; the documentation-only window closed with merge commit
 `72162ec8fee557d9f612f0acbf3acb26769b57aa` at `2026-09-05T16:33:22Z`. No historical timestamp was reconstructed.

Completed or evidenced:

- [x] Local audit helper compares rendered intent with fetched live snapshots.
- [x] Policy requires `consensus.timeout_commit = "500ms"`.
- [x] Policy rejects CometBFT RPC bound to `0.0.0.0`.
- [x] Auditor self-test passes (2026-08-03).
- [x] Safe one-sentry-at-a-time runbook exists.
- [x] Dedicated forced-command monitoring key installed on all three consensus nodes (2026-08-10).
- [x] All three Ed25519 host fingerprints confirmed and pinned (2026-08-10).
- [x] Protected five-minute chain progression workflow is available on `main` and passing (2026-08-14).
- [x] Dedicated forced-command signing-state backup key installed on the validator (2026-08-10).
- [x] PR #139 requires two distinct public recipients and protected reviewers with self-review prevention (2026-09-01).
- [x] Protected dual-recipient backup run `33489075548` passed and uploaded two ciphertexts plus one manifest (2026-09-01).
- [x] Both custodians independently passed offline decryption and content validation at height `5,776,198`; no
      plaintext key file or recovery private key was shared/uploaded (2026-09-01).
- [x] First protected scheduled dual-recipient recurrence `33505116681` passed at height `5,802,670` and retained
      two ciphertexts plus one matching manifest (2026-09-01).

External inputs and authority required:

- [x] Admin access to the identified private repository `KaJLabs/Lithosphere-Production-Infra` is verified.
- [x] Private-infra PR #16 merged and publishes `ansible/inventory/mainnet-9005/` on the private repository's default
      branch at `339e9a9acb0b3e10bc0e0ea8ae1d0213f04925c4`.
- [x] The exact authorized playbook is `ansible/playbooks/mainnet-9005-drift-check.yml`; it hard-fails unless Ansible
      check mode is active.
- [x] Both sentry records bind raw CometBFT RPC to `tcp://127.0.0.1:27057`, resolving the desired-state policy conflict.
- [x] Litho Agent (`@lithoagent`) is assigned as Validator Infra, Chain, and CAB approver (2026-09-02).
- [x] Preserve the absent PR #17 UTC approval/window artifact as a historical evidence deficiency and record the named
      owners' accepted governance exception in private PR #23; do not reconstruct unknown timestamps.
- [x] Authority is limited to a read-only Ansible `--check --diff` run; no apply, configuration change, deployment,
      or restart is authorized.
- [x] Private PR #17 records completion of the separately approved one-sentry-at-a-time remediation; no validator
      restart or chain-state mutation occurred.
- [x] KaJ Labs assigned Litho Agent (`@lithoagent`) as primary responder, `@Jkasr` as independent backup responder,
      and Telegram through `@LITHO_Moniter_bot` as the approved alert destination (PR #149, 2026-09-02).
- [x] Two independent recovery custodians completed the documented recipient ceremonies offline.
- [x] Only their public records are configured as `BACKUP_RECIPIENT_PRIMARY` and `BACKUP_RECIPIENT_BACKUP`; recovery
      private keys remain offline and separately controlled.

Remaining actions:

- [x] Review and merge the private check-only playbook, scoped role, templates, inventory, and closure record without
      live snapshots or credentials (private PRs #16 and #17).
- [x] Isolate the mainnet-only inventory/role from the obsolete AWS and unrelated template deltas.
- [x] Render intent, compare all three live nodes read-only, and record the baseline finding in private PR #17.
- [x] Align both production sentries to the reviewed `timeout_commit = "500ms"` and loopback raw-RPC intent.
- [x] Roll the two production sentries one at a time with rollback and catch-up/chain checks; the validator was not
      restarted (private PR #17 closure record).
- [x] Re-audit after rollout: `changed=0`, `unreachable=0`, and `failed=0` on all three nodes.
- [x] Private PR #18 merged the scheduled drift implementation; PR #19 records approval of `vps2`, daily 03:17 UTC,
      14-day sanitized retention, and Litho Agent (`@lithoagent`) as rollback owner.
- [x] Configure the three `litho-mainnet-drift` environment secrets with a dedicated forced-command key and pinned
      control-host record; no validator private key is stored in GitHub.
- [x] Run a controlled monitoring alert and verify delivery to the configured Telegram destination
      (`33635711860`, 2026-09-02).
- [x] Retain independent receipt acknowledgements from both `@lithoagent` and `@Jkasr` (client-confirmed,
      2026-09-02).
- [x] Merged PR #153 routes controlled tests through the secret-free protected `litho-mainnet-monitoring-test`
      environment without placing an approval gate in front of automatic incidents.
- [x] Run and verify the first manual drift check (`33688898843`): three hosts, zero changed, unreachable, or failed.
- [x] Verify a successful automatic recurrence after the initial fail-closed pinning defect was corrected in private
      PR #22 (`33953350571`, 2026-09-05): three hosts, zero changed, unreachable, or failed.
- [x] Run one successful protected encrypted signing-state backup (`33489075548`).
- [x] Perform isolated, non-signing recovery verification independently for both recipients.
- [x] Confirm the first post-activation scheduled dual-recipient backup passes without a manual workflow dispatch
      (`33505116681`; protected environment approval retained).

Acceptance criteria:

- [x] Reviewed Ansible dry-run identified only the sentry raw-RPC and proxy-upstream cleanup recorded in PR #17.
- [x] Every targeted node passes the final exact intent-vs-live audit.
- [x] No direct public CometBFT listener remains on either sentry; public queries continue through the policy-gated
      proxy.
- [x] Both sentries recovered and public verification confirmed chain identity, caught-up state, and block progression.
- [x] Five-minute chain progression monitoring, named alert ownership, and Telegram delivery are active.
- [x] Scheduled private-repository configuration drift detection is active; first manual run passed.
- [x] Encrypted signing-state backup and isolated verification drill pass under two-person recovery custody.
- [x] Validator Infra, Chain, and CAB approvers, closure evidence, and the accepted historical-window exception are
      recorded.

Evidence:

- `scripts/validator-config-audit.mjs`
- `config/validator-config-policy.json`
- `docs/runbooks/validator-infra-cleanup.md`
- `docs/VALIDATOR_TEAM_ACTION_ITEMS.md`
- `.github/workflows/mainnet-chain-monitor.yaml`
- `.github/workflows/mainnet-signing-state-backup.yaml`
- `infra/litho-mainnet-9005/ansible/playbooks/mainnet-9005-deploy-monitor-account.yml`
- `infra/litho-mainnet-9005/ansible/playbooks/mainnet-9005-deploy-backup-export.yml`
- Latest inspected passing scheduled monitor run: `https://github.com/KaJLabs/Lithosphere/actions/runs/33659094490`
- Passing controlled Telegram delivery: `https://github.com/KaJLabs/Lithosphere/actions/runs/33635711860`
- Passing protected post-merge Telegram delivery: `https://github.com/KaJLabs/Lithosphere/actions/runs/33671700384`
- Alert ownership and delivery runbook: `https://github.com/KaJLabs/Lithosphere/pull/149`
- Controlled-test approval separation: `https://github.com/KaJLabs/Lithosphere/pull/153`
- Scheduled drift implementation: `https://github.com/KaJLabs/Lithosphere-Production-Infra/pull/18`
- Scheduled drift approval record: `https://github.com/KaJLabs/Lithosphere-Production-Infra/pull/19`
- Passing first manual drift run: `https://github.com/KaJLabs/Lithosphere-Production-Infra/actions/runs/33688898843`
- Passing automatic drift recurrence: `https://github.com/KaJLabs/Lithosphere-Production-Infra/actions/runs/33953350571`
- Reviewed control-commit pinning fix: `https://github.com/KaJLabs/Lithosphere-Production-Infra/pull/22`
- Accepted PR #17 window-evidence exception: `https://github.com/KaJLabs/Lithosphere-Production-Infra/pull/23`
- Passing dual-recipient backup: `https://github.com/KaJLabs/Lithosphere/actions/runs/33489075548`
- Passing first scheduled recurrence: `https://github.com/KaJLabs/Lithosphere/actions/runs/33505116681`
- Dual-recipient implementation: `https://github.com/KaJLabs/Lithosphere/pull/139`
- Resolved backup incident: `https://github.com/KaJLabs/Lithosphere/issues/74`
- Private inventory/check-only playbook: `https://github.com/KaJLabs/Lithosphere-Production-Infra/pull/16`
- Private drift/remediation closure: `https://github.com/KaJLabs/Lithosphere-Production-Infra/pull/17`

## MX-07 — Developer infrastructure toolchain full release

**Owners:** Lithic/compiler team + Dev Infra/release owner + Security reviewer

**Current state:** All eight public binary boundaries have now been reviewed and merged with three-OS CI coverage.
Four are deliberately specification-only because their required semantics have not been approved. PR #111 committed
the workspace lockfile, added one declaration-front-end example, and merged checksummed, 14-day, non-release preview
archives with explicit capability manifests and packaged-command checks on Linux, Windows, and macOS. The local draft
that would have attached all eight binaries to arbitrary `v*` public releases was excluded. Review of the first
shared-syntax/`lithc` slice found that the
local semantic pass inferred an unapproved primitive-type table, overload behavior, map-key restrictions, and return
semantics. PR #95 removed those assumptions, added only unambiguous declaration-name checks, introduced a three-OS
CI gate, passed every gate, and merged as `cf68f7c001cd6a847f806cac09659bf72380bda2`. The tracked release still
keeps `lithls`, `lithtest`, `lithsec`, and `lithpkg` at honest specification-only boundaries. `lithc` still does not
parse/lower full function bodies into deployable LithoVM/EVM bytecode.

| Tool | Local implementation | Required before full-release acceptance |
| --- | --- | --- |
| `lithc` | Lexer/parser, conservative declaration-name checks, and AST/ABI/check output on `main`. | Approved type/overload/map/return semantics, full statements/expressions, typed IR, deterministic bytecode/codegen, source maps, diagnostics, and conformance tests. |
| `lithfmt` | Parse-safe, literal-preserving whitespace normalization and `--check` on `main`. | Decide whether whitespace-only v0 is accepted or implement AST-driven canonical formatting/idempotence corpus. |
| `lithlint` | Reviewed L001–L004 declaration rules, warning denial, exact single-file CLI behavior, boundary tests, and v0 limitations on `main`. | Product/release-owner acceptance of the rule/version policy and decision on suppression/configuration behavior. |
| `lithls` | Reviewed specification-only boundary on `main`; packaged stub explicitly refuses `--stdio` and does not advertise LSP support. | Product/release-owner acceptance of spec-only scope; any future server must meet the documented LSP 3.17/JSON-RPC conformance, real-span, three-OS, and editor gates. |
| `lithdev` | Strict local Compose lifecycle, conservative declaration checks, read-only ABI output, and fail-closed deploy preflight on `main`. Destructive volume deletion is excluded. | Operator acceptance with a running local Docker engine; compiler bytecode, simulation, signing, broadcast, receipt verification, and safe account/network policy before real deploy support. |
| `lithtest` | Reviewed specification-only boundary on `main`; packaged stub explicitly refuses `--run` and source paths, so raw body text cannot be reported as executed tests. | Approved test syntax plus typed compiler/LithoVM execution, fixtures/isolation, failure traces, gas/coverage decisions, conformance suite, and release-owner acceptance. |
| `lithsec` | Reviewed specification-only boundary on `main`; packaged stub explicitly refuses `--scan` and source paths, so heuristics cannot be presented as security results. | Approved threat model, typed-IR analysis, rule/version/severity/suppression policy, positive/negative corpus, false-result measurements, and independent compiler/security acceptance. |
| `lithpkg` | Reviewed specification-only boundary on `main`; packaged stub explicitly refuses `--resolve` and manifest paths, so an incomplete resolver or weak lock integrity cannot be presented as package management. | Approve manifest/lock schemas, full dependency resolution, path/symlink safety, cryptographic integrity and trust policy, atomic writes, compiler integration, and conformance criteria. |

Completed or evidenced locally:

- [x] All eight binaries have versioned local v0 command implementations.
- [x] Shared parser/semantic front-end is used across applicable tools.
- [x] Local `cargo fmt --check` and Clippy with warnings denied pass (2026-08-03).
- [x] Three-OS CI and honest, non-release boundary-preview archives are merged on `main`.
- [x] The July readiness run recorded 29 Rust tests and a release build passing in an environment with a linker.
- [x] Inventoried the 1,700+ line local multi-tool change and isolated shared syntax/`lithc` rather than bulk-committing
      unrelated tools (2026-08-16).
- [x] Removed unapproved type, overload, map-key, and return assumptions from the first review candidate; added
      conservative duplicate const/state-field/parameter checks plus `lithc --emit check`.
- [x] Local targeted rustfmt, workspace `cargo check`, and Clippy with warnings denied for the reviewed crates pass.
- [x] Added a three-OS CI candidate to run scoped formatting/Clippy, full workspace tests/release build, and a real
      `lithc` smoke check.
- [x] PR #95 passed Linux, Windows, and macOS formatting, Clippy, 12 Rust tests, full workspace release builds, and
      `lithc` smoke checks, then merged as `cf68f7c001cd6a847f806cac09659bf72380bda2` (2026-08-16).
- [x] Reviewed `lithfmt` and found its claimed safe tab/trailing-space normalization also rewrote string and
      byte-string literal contents; isolated a token-span-based preservation fix and three focused tests.
- [x] PR #97 passed Linux, Windows, and macOS formatting, Clippy, all 15 Rust tests, full workspace release builds,
      and `lithc` smoke checks, then merged as `f8bbb2d642638158c79c9fe22235d9766ab51a2a` (2026-08-16).
- [x] Reviewed `lithlint` without accepting the draft `0.1.0` bump; documented the exact L001–L004 declaration
      boundary, rejected ambiguous multiple-file invocation, and added three rule-boundary plus two CLI tests.
- [x] PR #99 passed Linux, Windows, and macOS formatting, Clippy, all 20 Rust tests, full workspace release builds,
      and `lithc` smoke checks, then merged as `0e70108e59f3f68ccae1f90ae38c4d831bd1c389` (2026-08-16).
- [x] Rejected the uncommitted `lithls` `0.1.0` hand-parser draft because it used substring JSON extraction,
      placeholder ranges, incomplete lifecycle/position handling, and had no editor conformance evidence.
- [x] PR #101 kept `lithls` at `0.0.1`, made `--stdio` fail closed, added the reviewed LSP 3.17/JSON-RPC 2.0
      implementation specification and three CLI tests, then passed all 23 Rust tests and full release builds on
      Linux, Windows, and macOS and merged as `9b8f304aaa257031b0675e2a6e9e2eff4fb8358a` (2026-08-16).
- [x] Reworked the unreviewed `lithdev` draft to reject volume deletion, extra/irrelevant arguments, file overwrite,
      fake type-check/deploy claims, and any RPC mutation while retaining strict local Compose lifecycle commands.
- [x] PR #103 added eight parser/CLI safety tests, passed all 31 Rust tests and full workspace release builds on
      Linux, Windows, and macOS, and merged as `d6d1a26b41aecce6ed17c7213b56528ef6fce90e` (2026-08-16).
- [x] Rejected the uncommitted `lithtest` `0.1.0` raw-body scanner because it could match comments/literals, ignored
      arbitrary code, passed empty tests, and executed no typed control flow, state, or LithoVM bytecode.
- [x] PR #105 kept `lithtest` at `0.0.1`, made execution fail closed, documented the syntax/compiler/VM/isolation
      gates, passed all 34 Rust tests and full release builds on Linux, Windows, and macOS, and merged as
      `b0e5372a71de2c08bafa0b9d0cb48c4ff5ce3ea9` (2026-08-16).
- [x] Rejected the uncommitted `lithsec` `0.1.0` text scanner because it inferred unapproved EVM/Lithic semantics,
      could match comments/literals, treated any assertion as access control, and lacked typed flow analysis.
- [x] PR #107 kept `lithsec` at `0.0.1`, made scanning fail closed, documented the threat-model/typed-analysis and
      false-result acceptance gates, passed all 37 Rust tests and full release builds on Linux, Windows, and macOS,
      and merged as `efca15c3d9f3b3c0dc3d0dd1241f7f02cb90c371` (2026-08-16).
- [x] Rejected the uncommitted `lithpkg` `0.1.0` draft because its hand-rolled manifest parser, incomplete resolver,
      direct path handling, FNV-1a checksum, and non-atomic lock writes did not satisfy an approved package boundary.
- [x] PR #109 kept `lithpkg` at `0.0.1`, made resolution fail closed, documented the schema/resolution/path/trust and
      compiler-integration gates, passed all 40 Rust tests and full release builds on Linux, Windows, and macOS, and
      merged as `729f9e2a2ec6908bc4bf583618162896e38d7c62` (2026-08-16).
- [x] Rejected the local public-release draft because it would relabel `0.0.1` crates with arbitrary release tags and
      publish four specification-only tools as if the full toolchain were available.
- [x] PR #111 committed the Cargo lockfile, added a reviewed declaration-only example, assembled capability-marked
      checksummed preview archives, verified every packaged command and fail-closed mode, passed both CI trigger sets
      on Linux, Windows, and macOS with all 40 Rust tests, and merged as
      `c942d275a38e3cd173752313b9921dd7fb801bb6` (2026-08-16).

Remaining actions:

- [x] Merge the reviewed shared syntax/`lithc` and CI slice after its Linux/Windows/macOS gates pass.
- [x] Separately review release packaging, examples, and lockfile; merge only non-release boundary-preview artifacts.
- [x] Merge the `lithfmt` literal-safety fix after three-OS tests and release builds pass.
- [ ] Record product/release-owner acceptance of the whitespace-only v0 formatter or implement the approved
      AST-driven canonical formatter boundary.
- [x] Run the full workspace tests/release build on Linux, Windows, and macOS. PR #99 passed both workflow trigger
      sets on all three operating systems with all 20 Rust tests and full workspace release builds.
- [ ] Specify full function-body grammar, semantics, ABI/bytecode compatibility target, and compiler conformance
      vectors with the LithoVM/chain team.
- [ ] Implement typed function bodies, control flow, storage operations, calls/events/reverts, lowering, deterministic
      bytecode, source maps, and actionable diagnostics.
- [ ] Execute generated contracts in the target VM and compare state, events, calls, gas behavior, and failure cases
      against approved conformance vectors.
- [ ] Complete `lithdev deploy` simulation, signing, broadcast, receipt, and verification only after codegen is trusted.
- [ ] Decide and document the v0 acceptance boundary for formatter, LSP, test runner, scanner, and package registry.
- [ ] After compiler/tool acceptance, publish signed/checksummed public-release archives for all supported platforms
      and run clean-environment install/smoke tests; current archives are CI-only boundary previews.
- [ ] Obtain independent compiler/security and release-owner acceptance.

Acceptance criteria:

- [ ] `lithc` emits deterministic deployable creation/runtime bytecode for the supported Lithic language.
- [ ] Compiler conformance, negative diagnostics, generated-contract execution, and deployment E2E tests pass.
- [ ] All eight binaries pass required tests/lints/builds on the supported OS matrix.
- [ ] `lithdev deploy` safely simulates, signs, broadcasts, waits, and verifies on an approved devnet account.
- [ ] Versioned archives, manifest, checksums/signatures, release notes, compatibility policy, and install docs are
      published in an immutable release.
- [ ] Compiler/security reviewer and release-owner approvals are recorded.

Evidence:

- `toolchain/README.md`
- `toolchain/Cargo.toml`
- `toolchain/crates/`
- `toolchain/examples/`
- `.github/workflows/ci-toolchain.yaml`
- `.github/workflows/release.yaml`
- `docs/guides/deploy-lithic-on-lithovm-mainnet.md`

## Recommended execution order

1. **Preserve and isolate local work.** Create reviewable stream-specific changes without sweeping up unrelated files.
2. **Send external requests in parallel.** Backend/Bridge, Wallet, DNNS, Quantt, Validator Infra, Chain, treasury,
   security, and release owners can respond while repository work proceeds.
3. **Close LEP100 faucet, Thanos, and DNNS.** These have the smallest remaining engineering surface and produce quick
   operational closures once approvals/funding arrive.
4. **Review and stage MultX/Lithoswap.** Deployment, liquidity, and reversible live tests require explicit authority.
5. **Activate Quantt only after its contract is received.** Do not guess endpoints or place keys in client code.
6. **Perform validator cleanup only in an approved window.** Use the private repo and roll one sentry at a time.
7. **Run the compiler/toolchain track in parallel.** It is the longest critical path and must not be represented as a
   full compiler release until real bytecode is executed successfully on LithoVM.

## Verification ledger

| Date (PKT) | Surface | Result | Notes |
| --- | --- | --- | --- |
| 2026-08-03 | Live Makalu config | PASS | HTTP 200; faucet and bridge enabled, swap disabled. |
| 2026-08-03 | Live faucet inventory | BLOCKED | Native LITHO funded; all ten LEP100 assets below the ten-token minimum. |
| 2026-08-03 | Live Quantt status | BLOCKED | HTTP 200; adapter deployed, `configured: false`. |
| 2026-08-03 | Quantt public endpoints | PARTIAL | Research site HTTP 200; dev hostname TLS verification fails. |
| 2026-08-03 | API | PASS | 163 tests passed; 9 live integration tests skipped; TypeScript build passed. |
| 2026-08-03 | Explorer | PARTIAL | 126 tests passed; lint warning-only. Standalone `tsc --noEmit` failed on test `ProcessEnv` and ES target settings. |
| 2026-08-03 | Contracts | PASS | 9 Hardhat tests passed, including 4 Lithoswap cases; compile passed. |
| 2026-08-03 | Faucet | PASS | TypeScript build passed. No live LEP100 claim could pass due to balances. |
| 2026-08-03 | Validator auditor | PASS | Self-test passed. Live validator inventory was not accessed. |
| 2026-08-03 | Rust toolchain | PARTIAL | Format and Clippy passed. Tests/build could not link because `link.exe` is absent on this host. |
| 2026-08-14 | Live Makalu config | PASS | HTTP 200; faucet and bridge enabled, swap disabled. |
| 2026-08-14 | Live faucet inventory | BLOCKED | Ten LEP100 assets present; five at zero and five at five, below minimum claim ten. |
| 2026-08-14 | Faucet safeguards | MERGED | PR #80 merged as `ef509281`; seven tests and strict TypeScript build passed. |
| 2026-08-14 | Faucet deployment | BLOCKED | No faucet image was published/deployed; live API still serves the previous payload. |
| 2026-08-14 | Faucet image pipeline | PASS | PR #82 merged as `f6303f9`; merged image run passed build, pre-publish Trivy gate, signing, provenance, and SBOM for all four services. No production deploy triggered. |
| 2026-08-14 | Faucet production release | BLOCKED | Rotate the exposed funding key, install the reviewed protected wrappers, replenish approved reserves, then run the manual gated release. |
| 2026-08-14 | Thanos deployment | PARTIAL | `/signin` and `/api/auth/nonce` respond; wallet-team acceptance remains. |
| 2026-08-14 | Thanos published release | PASS | Chrome Web Store reports `0.9.33`; matching source commit `c352a5cfef22` confirms EIP-6963, `fi.thanos.wallet`, `window.thanos`, and signing support. |
| 2026-08-14 | Thanos production auth | PASS | Makalu API secret checked value-free: present, non-placeholder, and at least 32 characters. `/signin` 200, nonce 200 with valid format, unauthenticated `/api/auth/me` 401. |
| 2026-08-14 | Thanos repository verification | PASS | API: 6 focused tests and TypeScript build passed. Explorer: all 128 tests passed; Next compilation/type validation passed before Windows denied standalone symlink creation. |
| 2026-08-14 | Thanos merge | PASS | PR #83 passed all 15 checks and merged as `6ded419ca7034f9ded110255dd1a2683d3399029`. |
| 2026-08-14 | Thanos deployment | ROLLED BACK | Run `31819790372` served the correct release SHA and passed core routes, but an incorrectly coupled faucet-schema condition failed; automatic rollback passed and restored the prior healthy release. |
| 2026-08-14 | Thanos deployment retry | PASS | PR #84 merged as `4fdb3ca`; run `31822244365` attempt 2 passed the core public gate. Live version, `/signin`, `/nfts`, stats, and nonce probes passed; faucet container start time and image remained unchanged. |
| 2026-08-14 | DNNS registry | PASS | Kamet chain ID 900523; configured registry address contains contract bytecode. |
| 2026-08-14 | DNNS forward records | PASS | All nine deployment-reserved `.litho` names resolve to the expected checksum address through their registry-selected resolver. |
| 2026-08-14 | DNNS reverse record | BLOCKED | The reverse node for the reserved-name address has no resolver; DNNS owner must configure or nominate a stable fixture. |
| 2026-08-14 | DNNS repository verification | PASS | All 134 explorer tests passed. Next compilation/type validation and static generation passed; Windows standalone symlink creation was denied by local OS policy. |
| 2026-08-14 | DNNS merge and deployment | PASS | PR #86 passed all checks and merged as `c5448da`; protected run `31826844798` deployed that exact release and passed the public health gate. |
| 2026-08-14 | DNNS post-deployment smoke | PASS | Public version reports `c5448da`; home/blocks return 200, shipped validation text is present, and `makalu.litho`/`faucet.litho` resolve to the expected address. |
| 2026-08-14 | Quantt | BLOCKED | Live adapter reports `configured: false`; development hostname fails TLS validation. |
| 2026-08-14 | Quantt public surfaces | PARTIAL | Research portal HTTP 200. `dev.quantt.at` resolves, but its certificate covers only `quantts.ai` names; the similar domain is not approved as a replacement. |
| 2026-08-14 | Quantt activation audit | IN PROGRESS | Base URL/key gate exists, but auth and path defaults were guessed. Local hardening requires both explicitly and adds the missing acceptance record. |
| 2026-08-14 | Quantt repository verification | PASS | Five focused tests and all 164 API tests passed; nine live-integration tests remained intentionally skipped; strict TypeScript build passed. |
| 2026-08-14 | Quantt merge and deployment | PASS | PR #88 passed all checks and merged as `c01ec48`; protected run `31828985116` deployed that exact release and passed the public health gate. |
| 2026-08-14 | Quantt post-deployment smoke | PASS (disabled) | Public version reports `c01ec48`; page is HTTP 200, status is unconfigured with null origin, and insights fail closed with HTTP 503. |
| 2026-08-14 | Mainnet chain monitor | PASS | Three latest inspected protected runs passed. |
| 2026-08-14 | Signing-state backup | BLOCKED | Scheduled workflow fails closed because `BACKUP_RECIPIENT` is empty. |
| 2026-08-15 | MultX live feature state | PASS (disabled swap) | Config reports bridge enabled and swap disabled; `/swap` and `/cross-swap` return 200 with unavailable states. |
| 2026-08-15 | MultX v0.5 redeployment gates | MERGED | PR #75 passed all checks and 84 local Hardhat tests after UTC-window enforcement; merged as `5570c95` with no deployment. |
| 2026-08-16 | MultX signer proposal | CLOSED | AWS KMS/IAM PR #78 was closed without merge; current `main` retains the provider-neutral VPS signer/quorum implementation for separate review. |
| 2026-08-15 | MultX toolchain audit | PARTIAL | `npm audit --omit=dev` reports zero; full operational/test dependency audit reports 3 critical and 14 high transitive findings. |
| 2026-08-16 | Lithoswap V2 repository review | MERGED | PR #68 passed every repository check and merged as `07b37969`; current-main build, 28 full Hardhat tests, 23 focused DEX/configuration tests, nine E2E checks, strict TypeScript, and Slither with zero detectors passed. No deployment or funding occurred. |
| 2026-08-16 | Lithoswap V2 toolchain audit | PARTIAL | Contract package has no production runtime dependencies; its Hardhat/test-only dependency graph reports 1 critical, 55 high, 43 moderate, and 10 low transitive advisories. |
| 2026-08-16 | Provider-neutral signer review | MERGED | PR #93 passed all checks and merged as `60f3f7bb`; 11 signer, 18 API, and 88 bridge-contract tests pass; all three production dependency audits report zero. No deployment or key access occurred. |
| 2026-08-16 | Toolchain shared front-end review | MERGED | PR #95 passed on Linux, Windows, and macOS with 12 Rust tests, full workspace release builds, Clippy/formatting, and `lithc` smoke checks; merged as `cf68f7c0`. |
| 2026-08-16 | `lithfmt` safety review | MERGED | PR #97 fixed literal-content corruption and passed Linux, Windows, and macOS gates with all 15 Rust tests and full workspace release builds; merged as `f8bbb2d6`. |
| 2026-08-16 | `lithlint` v0 boundary review | MERGED | PR #99 rejected ambiguous multiple-file use, added five rule/CLI tests, retained version `0.0.1`, and passed Linux, Windows, and macOS gates with all 20 Rust tests and full workspace release builds; merged as `0e70108e`. |
| 2026-08-16 | `lithls` specification review | MERGED | PR #101 retained the requested spec-only scope, made `--stdio` fail closed, excluded the non-conformant local server draft, and passed Linux, Windows, and macOS gates with all 23 Rust tests and full workspace release builds; merged as `9b8f304a`. |
| 2026-08-16 | `lithdev` safe-v0 review | MERGED | PR #103 added bounded local Compose lifecycle, read-only declaration/ABI commands, and fail-closed deploy preflight; eight safety tests reject destructive or misleading behavior. All three OS gates passed with 31 Rust tests and full release builds; merged as `d6d1a26b`. |
| 2026-08-16 | `lithtest` specification review | MERGED | PR #105 retained the requested spec-only scope, made execution fail closed, excluded the raw-body assertion scanner, and passed Linux, Windows, and macOS gates with all 34 Rust tests and full workspace release builds; merged as `b0e5372a`. |
| 2026-08-16 | `lithsec` specification review | MERGED | PR #107 retained the requested spec-only scope, made scanning fail closed, excluded the unapproved SEC001–SEC005 text heuristics, and passed Linux, Windows, and macOS gates with all 37 Rust tests and full workspace release builds; merged as `efca15c3`. |
| 2026-08-16 | `lithpkg` specification review | MERGED | PR #109 retained the requested spec-only scope, made resolution fail closed, excluded the incomplete manifest/resolver and weak-integrity draft, and passed Linux, Windows, and macOS gates with all 40 Rust tests and full workspace release builds; merged as `729f9e2a`. |
| 2026-08-16 | Toolchain preview packaging review | MERGED | PR #111 committed the lockfile and reviewed example, excluded the misleading public-release draft, and passed both three-OS trigger sets with locked builds, 40 tests, staged-command/fail-closed checks, SHA-256 generation, and artifact uploads; merged as `c942d275`. |
| 2026-08-16 | Mainnet monitor live recheck | PASS | The latest inspected scheduled chain-monitor run `31945720631` passed. |
| 2026-08-16 | Signing-state backup live recheck | EXTERNAL BLOCKER | Run `31933222228` failed configuration validation because `BACKUP_RECIPIENT` is empty; SSH/export/encryption steps were skipped and deduplicated incident #74 remains open. |
| 2026-08-16 | Faucet runbook safety review | READY | Removed obsolete hosting/direct-sudo instructions and assumed funding amounts; replacement requires explicit drain/funding approvals, secret-manager custody, restricted VPS wrappers, immutable images, public smoke tests, alert evidence, and rollback ownership. |
| 2026-08-23 | Faucet priority | DEFERRED | Client accepted the faucet for now and directed the team to more important work; no rotation, funding, deployment, or secret change was performed. |
| 2026-08-23 | MultX v0.8.1 candidate verification | PASS, NOT DEPLOYABLE | Exact `6ab0dcb`/`multx-audit-candidate-v0.8.1-20260822` checkout passed 112 contract, 32 API, and 23 signer tests. Autha fix review and production approvals remain mandatory. |
| 2026-08-23 | Deployment access | CLIENT-CONFIRMED | Access is available, but no credential was exposed or tested and no deployment/activation authorization was inferred. |
| 2026-09-01 | Dual-recipient backup activation | PASS (MANUAL) | PR #139 merged; approved manual run `33489075548` produced two independently encrypted ciphertexts and a manifest at signed height `5,776,198`; artifact hashes match the manifest. First scheduled recurrence remains to be observed. |
| 2026-09-01 | Dual-recipient recovery drill | PASS | Primary and backup custodians independently passed offline decryption and content validation at height `5,776,198`; no plaintext key files were written locally and no recovery private key was shared/uploaded. Incident #74 closed. |
| 2026-09-01 | Dual-recipient scheduled recurrence | PASS | Protected scheduled run `33505116681` on merged commit `9d09afa72d865b9c957396d386e0a50a4e282245` produced two distinct-recipient ciphertexts and a matching manifest at signed height `5,802,670`; no recovery private key was used and no plaintext key files were written locally. |
| 2026-09-01 | MX-06 private inventory gate | BLOCKED | Private PR #16 merged the strict-host-key inventory, check-only drift playbook, and loopback sentry RPC intent as `339e9a9acb0b3e10bc0e0ea8ae1d0213f04925c4`; approver assignments remain pending, so no Ansible command ran. |
| 2026-09-02 | MX-06 mainnet drift closure | PASS, FOLLOW-UPS OPEN | Litho Agent (`@lithoagent`) was assigned to all three approval roles. Private PR #17 records one-at-a-time sentry RPC/proxy remediation and a final clean three-node drift run. Independent public probes confirmed chain IDs, progression, caught-up state, and closed direct sentry RPC ports. Scheduled drift detection, independent responder/alert assignments, alert-delivery evidence, and the exact UTC approval/window link remain open. |
| 2026-09-02 | MX-06 monitoring ownership and delivery | PASS, FOLLOW-UPS OPEN | PR #149 records `@lithoagent` as primary responder, `@Jkasr` as independent backup, and Telegram via `@LITHO_Moniter_bot` as the approved channel. Both environment-scoped Telegram secrets exist, controlled run `33635711860` passed health and delivery, scheduled run `33659094490` passed, and the client confirmed both responders acknowledged receipt. Monitoring-environment reviewer protection remains open. |
| 2026-09-02 | MX-06 controlled-test protection design | MERGED, FOLLOW-UPS OPEN | The secret-free approval environment requires `@lithoagent` or `@Jkasr` review with self-review prevention. PR #153 merged the controlled-test gate without blocking unattended incident monitoring. |
| 2026-09-03 | MX-06 scheduled drift activation | PASS (MANUAL), RECURRENCE OPEN | Private PRs #18 and #19 are merged. The approved `vps2` forced-command runner is active with pinned host trust and environment-scoped credentials; no validator key is stored in GitHub. Manual run `33688898843` passed on all three nodes with zero changed, unreachable, or failed tasks. The first 03:17 UTC scheduled recurrence remains to be observed. |
| 2026-09-05 | MX-06 protected alert and drift recurrence | PASS, ONE EVIDENCE GATE OPEN | `@lithoagent` approved protected test run `33671700384`; health, approval, and Telegram delivery passed. After two automatic drift attempts failed closed on a reviewed-commit pinning defect, private PR #22 corrected the control, and scheduled run `33953350571` passed with a clean three-host sanitized artifact and zero changed, unreachable, or failed tasks. Only the exact PR #17 UTC maintenance approval/window artifact remains open. |
| 2026-09-05 | MX-06 final governance closure | COMPLETE | Private PR #23 preserves the missing historical PR #17 approval-window artifact as an accepted exception. The project representative confirmed the named owners privately approved it and instructed `BrewCodeDev` to merge; merge `72162ec8` closed the documentation-only window at `2026-09-05T16:33:22Z`. No historical timestamp was reconstructed and no infrastructure operation occurred. |
| 2026-09-09 | MX-01 MultX v0.9.2 acceptance | PASS, ACTIVATION GATED | Annotated tag `multx-audit-candidate-v0.9.2-20260908` resolves to `5994f263b9d1fd40c531410d6b23884eade9f5b9`. The supplied Autha receipt binds the accepted source and bytecode-evidence hashes, and all three report-file hashes match. M-03/L-01/L-02/O-04 are closed; Autha O-01/package O-02 operational readiness remains open. The accepted commit is not contained in public `main`; v0.9.0 is unaccepted and must not be deployed. No deployment or activation occurred. |
| 2026-09-09 | MX-01 mainline merge topology | CORRECTION OPEN | PR #168 squash-merged accepted source content as `e7322e6`, but exact accepted commit `5994f263` is not an ancestor of `main`. PRs #169-#171 were merged into stacked feature branches rather than `main`. Corrective PR #173 has current `main` and reviewed head `ef0ebc5` as merge parents, contains only the effective #169-#171 diff, preserves every reviewed commit as an ancestor, and passes 60 API, 43 signer, and 153 contract tests. It must be merged with a merge commit; private readiness PR #24 is still open. No deployment or activation occurred. |
| 2026-09-09 | MX-01 mainline and readiness preparation merges | MERGED, ACCEPTANCE GATES OPEN | PR #173 merged as two-parent commit `b54cb55`; accepted commit `5994f263` and reviewed #169-#171 commits are ancestors of `main`. Private PR #24 merged as two-parent commit `571e96a` with the recovery-owner correction. GitHub records no submitted reviews on either PR, so these merges do not close independent post-acceptance review or Autha O-01/package O-02 operational readiness. No deployment or activation occurred. |
| 2026-09-10 | MX-01 private routing/probe review | MERGED, INDEPENDENT ACCEPTANCE OPEN | Private PR #25 merged as `e64f7c7` with reviewed head `ef4ddb4` as its second parent after standards/spec review, fail-closed EVM-address and JSON-RPC-checkpoint fixes, 25 passing tests, and green CI run `34395277331`. GitHub records no submitted review. Real elapsed-time cap rollover, production indexer verification, production inputs, and independent acceptance remain open. No deployment or activation occurred. |

## Change log

### 2026-09-10 — MX-01 routing/probe review merged

- Reviewed private PR #25 against its development-only specification and repository security standard.
- Fixed acceptance of invalid/zero router and bridge identifiers and malformed chain, block-number, timestamp, and
  block-hash RPC values in both read-only probes.
- All 25 tests, the offline example, Python compilation, diff validation, and CI run `34395277331` passed at
  `ef4ddb444ffc1006d970e27829bf53a7433872df`.
- Reconciled documentation with the merged public native-verifier candidate and newer scoped local evidence without
  treating either as Autha v0.9.2 acceptance or deployment approval.
- Private PR #25 merged as `e64f7c7a075acd7799fbe253103ca8ec18ffc655`, preserving reviewed head
  `ef4ddb444ffc1006d970e27829bf53a7433872df` as its second parent. GitHub records no submitted independent approval,
  so post-merge acceptance, the one-time elapsed cap rollover, production indexer evidence, production inputs, and
  O-01/package O-02 remain open.
- MultX, Bridge signing, Swap, and Faucet remain disabled; no deployment, funding, key access, or activation occurred.
- Updated by: `bachal-mb`.

### 2026-09-09 — MX-01 accepted lineage and readiness preparation merged

- Verified public PR #173 merged as `b54cb55e62e8be92b8842a8b6485872ec7c9f015` with current `main` and the
  corrective branch as parents.
- Verified exact Autha-accepted commit `5994f263b9d1fd40c531410d6b23884eade9f5b9`, the complete reviewed
  #169-#171 stack, and corrective merge `74f675d1478644f461c55ee465296d56c814e161` are ancestors of public `main`.
- Verified private PR #24 merged as `571e96ad22d7dd373b8aa0ef3acfea56cfb2100e` with corrected readiness head
  `2f160d42955f2f4f697575d57388e4b8b0ee06ca` as its second parent.
- GitHub reports no submitted reviews on PR #173 or private PR #24. Independent acceptance of post-v0.9.2 changes
  and the operator package remains required before deployment.
- Autha O-01/package O-02 production inputs, disabled staging, recovery, monitoring, canary, and activation gates
  remain open.
- MultX, Bridge signing, Swap, and Faucet remain disabled; no deployment, funding, key change, or activation occurred.
- Updated by: `bachal-mb`.

### 2026-09-09 — MX-01 stacked-merge correction prepared

- Verified PR #168 was squash-merged as `e7322e6a3c98843e05379e6fa03796a712b8168a`; its accepted source content is
  present, but exact Autha-accepted commit `5994f263b9d1fd40c531410d6b23884eade9f5b9` is not an ancestor of `main`.
- Verified PRs #169, #170, and #171 were merged into their preceding feature branches and therefore did not land on
  `main`.
- Prepared corrective PR #173 with current `main` as first parent and reviewed stack head
  `ef0ebc58d3607a05fbaffbced1ff76e2444220e1` as second parent. The accepted v0.9.2 commit and every reviewed
  post-acceptance commit are ancestors of its head.
- Re-ran 60 API tests, 43 signer tests (34 pass and nine Windows-only skips), and 153 contract tests successfully.
- Verified private PR #24 remains open. Its recovery-owner independence fix is present and CI passes, but independent
  review and merge remain required.
- MultX, Bridge signing, Swap, and Faucet remain disabled; no deployment, funding, key change, or activation occurred.
- Updated by: `bachal-mb`.

### 2026-09-09 — MX-01 Autha acceptance moved to superseding v0.9.2

- Verified annotated tag `multx-audit-candidate-v0.9.2-20260908` resolves to exact commit
  `5994f263b9d1fd40c531410d6b23884eade9f5b9`.
- Verified the supplied acceptance receipt's v0.9.2 source and bytecode-evidence identities and independently matched
  all three retained Autha report SHA-256 values.
- Recorded Autha closure of M-03, L-01, L-02, and O-04; Autha O-01/package O-02 operational readiness remains open.
- Recorded that v0.9.0 never received written independent acceptance and must not be deployed.
- Verified the accepted v0.9.2 commit is tagged but not contained in public `main`; an explicitly approved,
  exact-source deployment path remains required.
- No contract deployment, signer startup, key access, asset movement, canary, feature activation, or production change
  was performed.
- Updated by: `bachal-mb`.

### 2026-09-05 — MX-06 validator infrastructure cleanup closed

- Verified private PR #23 merged as `72162ec8fee557d9f612f0acbf3acb26769b57aa` at
  `2026-09-05T16:33:22Z`.
- Recorded the project representative's attestation that the named owners privately approved the governance exception
  and instructed `BrewCodeDev` to merge it.
- Preserved the original PR #17 approval-window timestamps as unknown; no retrospective approval artifact or timestamp
  was invented.
- Marked MX-06 complete based on its clean desired-state checks, recovery evidence, restricted monitoring, successful
  protected alert delivery, successful automatic drift recurrence, named ownership, and accepted evidence exception.
- No Ansible execution, configuration apply, node access, restart, transaction, or secret read was performed.
- Updated by: `bachal-mb`.

### 2026-09-05 — MX-06 protected alert and scheduled drift recurrence verified

- Verified `@lithoagent` approved protected workflow run `33671700384`; its read-only health check, approval gate, and
  controlled Telegram delivery all passed.
- Reviewed the scheduled-drift history rather than ignoring failed attempts. The 2026-09-03 and 2026-09-04 schedules
  failed closed because documentation merges changed `main` while the control host correctly remained pinned to its
  reviewed operational commit.
- Verified private PR #22 separated the approved control-host commit from the workflow commit, and the subsequent
  automatic run `33953350571` passed.
- Downloaded and inspected that run's retained artifact: strict schema, chain `lithosphere_9005-1`, exactly three
  inventory aliases, `result: clean`, and zero changed, unreachable, or failed tasks.
- No configuration apply, node restart, transaction, or secret read was performed. MX-06 remains open only for the
  exact UTC approval/window artifact for the already completed private PR #17 maintenance.
- Updated by: `bachal-mb`.

### 2026-09-03 — MX-06 scheduled drift detection activated

- Merged private-infra PR #18 and approval-record PR #19; approved `vps2`, daily 03:17 UTC, 14-day sanitized-report
  retention, and Litho Agent (`@lithoagent`) as rollback owner.
- Installed the root-owned wrapper at commit `d678eacd8eded1afb8135d6999111720bd8f3ae9` behind a dedicated SSH
  forced-command account. An arbitrary command test was denied with exit 64.
- Configured only the dedicated runner host, runner key, and pinned host record in the `litho-mainnet-drift`
  environment. The existing node credential remains root-only on the control host and was not placed in GitHub.
- Manual workflow run `33688898843` passed with all three hosts reachable and zero changed, unreachable, or failed
  tasks. Its retained artifact is the strict sanitized recap only.
- Kept MX-06 open until the first scheduled 03:17 UTC recurrence passes and the exact PR #17 maintenance-window
  approval evidence is linked.
- Updated by: `bachal-mb`.

### 2026-09-03 — MX-06 scheduled drift detection prepared

- Opened private-infra PR #18 with a daily 03:17 UTC check-only workflow, forced-command control-host wrapper, strict
  JSON sanitizer, four passing sanitizer tests, and 14-day sanitized-artifact retention.
- Created the secret-free `litho-mainnet-drift` environment and set only the non-secret runner username. No host,
  private key, or known-host secret was available or configured.
- Requested independent review from `@lithoagent` and `@Jkasr` and posted the exact activation checklist on PR #18.
- Did not merge, dispatch, connect to a node, apply configuration, or restart a service. The first manual and scheduled
  checks remain blocked on the approved control host, forced-command credential installation, pinned fingerprint, and
  secret-manager configuration.
- Updated by: `bachal-mb`.

### 2026-09-02 — MX-06 controlled-test protection prepared; drift automation blocker verified

- Created the secret-free `litho-mainnet-monitoring-test` environment with `@lithoagent` and `@Jkasr` as required
  reviewers and self-review prevention enabled.
- Opened PR #153 to put only controlled test alerts behind that gate; the existing automatic monitor environment and
  secrets were not changed, and no workflow or alert was triggered.
- Verified the private infrastructure repository contains no scheduled drift workflow, Actions environment, or
  Actions secrets. Its inventory currently expects a privileged root key, while the installed forced-command monitor
  identity cannot run Ansible.
- Kept scheduled drift automation blocked until the owners approve an execution host, a restricted credential model,
  cadence, and sanitized-report retention. An unrestricted validator key will not be stored in GitHub.
- Reconfirmed that private PR #17 contains no exact UTC maintenance approval/window artifact.
- Updated by: `bachal-mb`.

### 2026-09-02 — MX-06 monitoring ownership and controlled delivery verified

- Verified the documented GitHub identities resolve to Litho Agent (`@lithoagent`) and King Kasr (`@jkasr`).
- Verified merged PR #149 records the primary responder, independent backup responder, and approved Telegram channel.
- Verified `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` exist as environment-scoped secrets without exposing their
  values.
- Verified controlled workflow run `33635711860` passed the read-only three-node monitor and sent a `CONTROLLED TEST`
  message; scheduled run `33659094490` subsequently passed on current `main`.
- Recorded the client's confirmation that both responders independently acknowledged receipt of the controlled alert.
- Kept the monitoring protection gate open because the environment has no reviewer protection rules, contrary to the
  merged runbook.
- Updated by: `bachal-mb`.

### 2026-09-02 — MX-06 mainnet drift and sentry RPC closure verified

- Verified `@lithoagent` resolves to the GitHub user Litho Agent and recorded the client's assignment of that identity
  as Validator Infra, Chain, and CAB approver.
- Found the requested production operation already completed by the other team in merged private PR #17; did not run
  a duplicate Ansible or SSH operation.
- Reviewed the private closure record: both sentry raw RPC listeners and the sentry-1 Nginx upstream were moved to
  loopback one node at a time, the validator was not restarted, and the final check-only run reported `changed=0`,
  `unreachable=0`, and `failed=0` across all three nodes.
- Independently verified public Cosmos/REST chain ID `lithosphere_9005-1`, EVM chain ID `0x232d`, block progression
  `5,960,798` to `5,960,804`, `catching_up=false`, and direct port `27057` timeouts on both sentry IPs.
- Kept MX-06 open for scheduled private-repo drift detection, independent responder and alert-channel assignments, the
  controlled alert-delivery test, and a link to the exact UTC PR #17 approval/window record.
- Updated by: `bachal-mb`.

### 2026-09-01 — MX-06 private inventory and approval gate verified

- Verified admin access to the client-identified private repository without cloning or exposing repository content.
- Initially verified the claimed inventory was absent. Private PR #16 subsequently published and merged the inventory,
  exact check-only drift playbook, and supporting role at `339e9a9acb0b3e10bc0e0ea8ae1d0213f04925c4`.
- Verified the playbook refuses non-check-mode execution and both sentry records now keep raw CometBFT RPC on
  `tcp://127.0.0.1:27057`; the remaining pre-check blocker is the three named approver assignments.
- Reviewed the existing merged drift-detector source in the other developer repository. Its obsolete AWS inventory
  and disabled SSH host-key checking make it unsuitable for the current bare-metal mainnet inventory.
- Recorded the client's read-only `ansible --check --diff` authorization. No apply, configuration change, deployment,
  restart, or drift command was performed because Validator Infra, Chain, and CAB approvers remain unnamed.
- Updated by: `bachal-mb`.

### 2026-09-01 — MX-06 first scheduled dual-recipient recurrence verified

- Approved the protected environment gate for scheduled run `33505116681`; the workflow event remained `schedule`
  and ran against merged commit `9d09afa72d865b9c957396d386e0a50a4e282245`.
- Verified the run passed at signed height `5,802,670`, used no recovery private key, wrote no plaintext key files
  locally, and uploaded exactly two ciphertexts plus one manifest.
- Downloaded the artifact read-only and confirmed both ciphertext SHA-256 values match the manifest and the two
  public recipient fingerprints are distinct. No decryption, restore, restart, or validator mutation was performed.
- Closed the scheduled-recurrence checkpoint. MX-06 remains open for private-inventory configuration cleanup, drift
  detection, the controlled alert exercise, and final owner/CAB acceptance.
- Updated by: `bachal-mb`.

### 2026-09-01 — MX-06 dual-recipient backup activation and recovery verified

- Verified PR #139 merged as `a1e7bb1c40e05e6b9420d39383a06c787d128acb` and changed the protected workflow
  to require two distinct public recipient records.
- Verified environment protection requires reviewers and prevents self-review; both public recipient secrets are
  configured without exposing their contents.
- Verified protected run `33489075548` passed every step and retained two ciphertexts plus one non-secret manifest.
- Downloaded the artifact read-only and matched both ciphertext SHA-256 values to the manifest; its distinct public
  recipient fingerprints, chain ID, consensus public key, and signed height `5,776,198` are recorded.
- Recorded both custodians' independent offline decryption/content-validation results. No private recovery material
  was received, shared, uploaded, or committed; no restore or validator mutation occurred.
- Closed deduplicated backup incident #74 after its missing-recipient root cause was resolved. MX-06 remains open for
  the first scheduled recurrence, separately authorized validator configuration cleanup, drift detection, alert
  exercise, and final owner/CAB acceptance.
- Updated by: `bachal-mb`.

### 2026-08-23 — Client reprioritized faucet; MultX verification resumed

- Marked MX-02 deferred after the client accepted the current faucet for now; retained all unresolved rotation,
  funding, claims, alerting, and acceptance items without performing them.
- Recorded client-confirmed deployment access as capability only, not authority to deploy contracts, configure
  signer infrastructure, move assets, run a value-bearing canary, or enable features.
- Refreshed `origin/main` to `6ab0dcb0774421d6d57895b302ab8cc5b73d1762` and made MX-01 the active priority.
- Verified the exact v0.8.1 candidate locally: 112 contract, 32 API, and 23 signer tests passed.
- Deployment remains blocked on Autha's independent fix review, final evidence, architecture reconciliation,
  governance/routes/signers/finality inputs, and explicit canary/activation approvals. MultX remains disabled.
- Updated by: `bachal-mb`.

### 2026-08-16 — MX-02 protected faucet runbook prepared

- Replaced the obsolete faucet setup guide that referenced a retired hosting path, direct privileged file/container
  changes, and an unapproved example funding amount.
- The new runbook records the verified live old address and underfunded balances, but authorizes no drain, funding,
  deployment, key handling, or server change.
- Rotation now requires explicit old/new public-address approval, exact native and per-LEP100 amounts, separate
  treasury/deploy/VPS/rollback owners, secret-manager custody, and restricted root-owned wrapper checksums.
- Release closure requires an immutable signed image, fail-closed public schema, one verified claim per asset,
  post-claim balances, low-balance alert acknowledgement, and rollback evidence.
- Updated by: `bachal-mb`.

### 2026-08-16 — MX-06 live backup gate reconfirmed

- Scheduled chain-monitor run `31945720631` passed; monitoring remains active.
- Scheduled signing-state backup run `31933222228` failed closed at protected-configuration validation because
  `BACKUP_RECIPIENT` is empty. It did not connect to the validator or export signing state.
- Incident #74 is already open and deduplicated. No redundant manual run was triggered.
- The required next action remains owner-controlled: KaJ Labs assigns two independent recovery custodians, they
  complete the offline ceremony, and an authorized environment administrator stores only the resulting public
  recipient JSON in `litho-mainnet-backup`.
- Updated by: `bachal-mb`.

### 2026-08-16 — MX-07 boundary-preview packaging merged

- PR #111 passed both toolchain workflow trigger sets on Linux, Windows, and macOS with locked Clippy/tests/release
  builds, all 40 Rust tests, both `lithc` examples, packaged-command startup, and the four fail-closed boundaries.
- Each platform created and uploaded a 14-day archive with a SHA-256 file and manifest recording `release: false`,
  version `0.0.1`, source commit, platform, and exact capability labels.
- All standard repository gates passed; PR #111 merged by `bachal-mb` as
  `c942d275a38e3cd173752313b9921dd7fb801bb6`.
- The draft public release workflow and `0.1.0` relabeling were excluded. No GitHub release was published, and no
  compiler bytecode, deployment, signing, broadcast, package resolution, test execution, LSP, or security scan was
  claimed.
- Updated by: `bachal-mb`.

### 2026-08-16 — MX-07 `lithpkg` specification boundary merged

- PR #109 passed both workflow trigger sets on Linux, Windows, and macOS: scoped formatting and workspace-wide
  Clippy with warnings denied, all 40 Rust tests, full workspace release builds, and the `lithc` smoke check.
- All standard repository gates passed; PR #109 merged by `bachal-mb` as
  `729f9e2a2ec6908bc4bf583618162896e38d7c62`.
- The crate remains `0.0.1` and specification-only as requested. It refuses `--resolve` and manifest paths until
  schemas, resolution, path safety, cryptographic trust, atomic writes, compiler integration, and conformance rules
  are approved.
- The local hand-rolled parser/resolver and FNV-1a lock checksum draft were excluded; no dependency graph was
  resolved and no lockfile was presented as trustworthy.
- Updated by: `bachal-mb`.

### 2026-08-16 — MX-07 `lithsec` specification boundary merged

- PR #107 passed both workflow trigger sets on Linux, Windows, and macOS: scoped formatting and Clippy with warnings
  denied, all 37 Rust tests, full workspace release builds, and the `lithc` smoke check.
- All standard repository gates passed; PR #107 merged by `bachal-mb` as
  `efca15c3d9f3b3c0dc3d0dd1241f7f02cb90c371`.
- The crate remains `0.0.1` and specification-only as requested. It refuses scanning until the threat model,
  typed-IR analysis, rule/severity/suppression policy, corpus, and false-result thresholds are approved.
- The local SEC001–SEC005 raw-text draft was excluded; no contract was scanned or reported safe.
- Updated by: `bachal-mb`.

### 2026-08-16 — MX-07 `lithtest` specification boundary merged

- PR #105 passed both workflow trigger sets on Linux, Windows, and macOS: scoped formatting and Clippy with warnings
  denied, all 34 Rust tests, full workspace release builds, and the `lithc` smoke check.
- All standard repository gates passed; PR #105 merged by `bachal-mb` as
  `b0e5372a71de2c08bafa0b9d0cb48c4ff5ce3ea9`.
- The crate remains `0.0.1` and specification-only as requested. It refuses `--run` and source paths until test
  syntax, typed compilation, LithoVM execution, isolation, failure, gas/coverage, and conformance rules are approved.
- The local raw-body assertion draft was excluded; no Lithic tests or VM code were executed by `lithtest`.
- Updated by: `bachal-mb`.

### 2026-08-16 — MX-07 safe `lithdev` v0 merged

- PR #103 passed both workflow trigger sets on Linux, Windows, and macOS: scoped formatting and Clippy with warnings
  denied, all 31 Rust tests, full workspace release builds, and the `lithc` smoke check.
- All standard repository gates passed; PR #103 merged by `bachal-mb` as
  `d6d1a26b41aecce6ed17c7213b56528ef6fce90e`.
- `lithdev` now strictly parses local Compose lifecycle commands, preserves volumes on `down`, emits ABI only to
  stdout, and fails `deploy` closed before writes or RPC access. It does not claim full type checking or deployment.
- No Docker command, key access, signing, RPC mutation, volume deletion, or deployment occurred in this review.
- Updated by: `bachal-mb`.

### 2026-08-16 — MX-07 `lithls` specification boundary merged

- PR #101 passed both workflow trigger sets on Linux, Windows, and macOS: scoped formatting and Clippy with warnings
  denied, all 23 Rust tests, full workspace release builds, and the `lithc` smoke check.
- All standard repository gates passed; PR #101 merged by `bachal-mb` as
  `9b8f304aaa257031b0675e2a6e9e2eff4fb8358a`.
- The crate remains `0.0.1` and specification-only as requested. `--stdio` fails explicitly, while the reviewed
  implementation document now defines the protocol, safety, real-span, conformance, three-OS, and editor gates.
- The local `0.1.0` hand-parser draft was excluded; no working language server or release is claimed.
- Updated by: `bachal-mb`.

### 2026-08-16 — MX-07 `lithlint` v0 boundary merged

- PR #99 passed both workflow trigger sets on Linux, Windows, and macOS: scoped formatting and Clippy with warnings
  denied, all 20 Rust tests, full workspace release builds, and the `lithc` smoke check.
- All standard repository gates passed; PR #99 merged by `bachal-mb` as
  `0e70108e59f3f68ccae1f90ae38c4d831bd1c389`.
- `lithlint` remains version `0.0.1`. Its exact L001–L004 declaration boundary and limitations are documented; the
  rule/version policy and suppression/configuration decisions still require product/release-owner acceptance.
- Updated by: `bachal-mb`.

### 2026-08-16 — MX-07 `lithfmt` literal safety merged

- PR #97 passed Linux, Windows, and macOS formatting, reviewed-crate Clippy with warnings denied, all 15 Rust tests,
  full workspace release builds, and the `lithc` smoke check.
- All standard repository gates passed; PR #97 merged by `bachal-mb` as
  `f8bbb2d642638158c79c9fe22235d9766ab51a2a`.
- `lithfmt` now preserves string and byte-string contents while normalizing external whitespace. Product/release
  acceptance of the whitespace-only v0 boundary remains open; no 0.1.0 release was published.
- Updated by: `bachal-mb`.

### 2026-08-16 — MX-07 `lithfmt` safety fix isolated

- Verified the local draft contained no formatter behavior change beyond a release version bump and mechanical
  formatting; the version bump was not accepted without full-release approval.
- Found that the tracked formatter expanded tabs inside string/byte-string literals and could trim trailing content
  inside multiline literals despite describing itself as unable to corrupt a contract.
- Added lexer-token-span protection so literal bytes remain unchanged while external whitespace is normalized, plus
  literal, multiline, and idempotence tests.
- Expanded the three-OS toolchain gate to format and lint `lithfmt`; hosted tests/release builds await PR CI.
- Updated by: `bachal-mb`.

### 2026-08-16 — MX-07 shared front-end and CI merged

- PR #95 passed Linux, Windows, and macOS formatting, reviewed-crate Clippy with warnings denied, all 12 Rust tests,
  full workspace release builds, and a real `lithc --emit check` smoke test against `DOGE.lithic`.
- All standard repository gates also passed; PR #95 merged by `bachal-mb` as
  `cf68f7c001cd6a847f806cac09659bf72380bda2`.
- This closes only the first review slice. The remaining tools, compiler semantics, codegen, conformance, packaging,
  and release acceptance remain open, and no deployable compiler artifact is claimed.
- Updated by: `bachal-mb`.

### 2026-08-16 — MX-07 shared front-end review isolated

- Inventoried the uncommitted toolchain work without modifying the original dirty workspace and isolated the shared
  syntax/`lithc` slice from the other tools, examples, lockfile, and release packaging.
- Rejected the local semantic pass's unapproved primitive-type, overload, map-key, and return assumptions.
- Added only conservative duplicate const, state-field, and parameter checks plus an honest `lithc --emit check`
  mode that does not claim full type checking or code generation.
- Added Linux/Windows/macOS CI for scoped format/Clippy, full workspace tests and release build, and a compiler smoke
  test. Local targeted rustfmt, workspace check, and reviewed-crate Clippy pass; hosted linker-backed CI is pending.
- No compiler release or deployable bytecode is claimed or published.
- Updated by: `bachal-mb`.

### 2026-08-16 — MX-01 provider-neutral signer hardening merged

- Every required/reporting check on PR #93 passed, including CodeQL, contracts, Foundry invariants, signer, API
  image, web, build, lint, typecheck, schema/ABI, and secret scanning.
- PR #93 merged by `bachal-mb` as `60f3f7bb151e9e2be48632468212e602220f40f4`.
- Repository hardening is complete; independent audit and operator acceptance remain required before any privileged
  deployment, followed by explicit controller and liquidity approvals before Swap can be enabled.
- No signer or contract was deployed, no key was accessed, no liquidity was funded, and Swap remains disabled.
- Updated by: `bachal-mb`.

### 2026-08-16 — MX-01 provider-neutral signer review hardened locally

- Verified the EIP-191 message domain matches both destination contracts, the API verifier, and release executor.
- Closed malformed-policy confirmation bypasses and rejected insecure/credential-bearing RPC and signer URLs,
  duplicate sources/routes, and zero critical addresses.
- Removed the static-network trust shortcut so the signer verifies the RPC's reported chain ID.
- Changed anti-equivocation handling to fsync the decision before signing; added restart and corrupt-journal tests.
- Rejected duplicate signer identities and invalid timeouts, serialized signing polls, counted only distinct current
  configured signer addresses, and removed implicit source-chain/release-token fallbacks.
- Made both bridge implementations reject duplicate validator identities at deployment and during rotation.
- Updated status/signature responses to expose the configured threshold, distinct counts, and deterministic lowercase
  signer ordering.
- Signer: 11 tests pass; API: 18 tests pass; bridge contracts: 88 tests pass; all three production dependency audits
  report zero vulnerabilities.
- No signer was deployed, no key was accessed, and no production configuration was changed.
- Updated by: `bachal-mb`.

### 2026-08-16 — MX-01 Lithoswap V2 repository slice merged

- Updated PR #68 to current `main` without touching the unrelated dirty workspace.
- Added critical-address and pair-initialization contract guards plus production invariant and flash-swap reentrancy
  tests.
- Removed the default WLITHO/deployer-controller assumptions. Deployment now requires explicit chain, WLITHO,
  fee-controller, clean-source, confirmation, receipt, manifest, and runtime-code-hash checks.
- Made liquidity seeding read-only by default, bound it to a versioned approved plan, exact initial ratios, an LP
  recipient, on-chain token metadata, and a separate chain-bound execution confirmation.
- Full/focused tests, E2E, strict TypeScript, and Slither passed. The test/deployment toolchain's transitive
  advisories are explicitly recorded; it must use a hardened ephemeral runner with trusted inputs.
- No contract was deployed, no token approval was sent, no liquidity was funded, and Swap remains disabled.
- Closed stale conflicting UI PR #69 as superseded by the tested, fail-closed Swap UI already on `main`.
- All current-head PR checks passed; PR #68 merged by `bachal-mb` as
  `07b37969f00d97eaca17794c31a83546b60a1940` without deployment or funding.
- Reverified AWS PR #78 unchanged, closed it as rejected architecture, and retained the non-AWS VPS signer path on
  `main` for separate operational review.
- Updated by: `bachal-mb`.

### 2026-08-15 — MX-01 MultX redeployment gates merged; swap remains disabled

- Reconciled `main`, the original dirty workspace, open PRs, and live feature state. Same-chain Lithoswap V2 source
  remains local-only; no router or liquidity deployment is recorded.
- Reviewed PR #75 and found its documented change-window gate was not enforced. Added explicit UTC start/end fields
  and blocked execution outside the interval before private-key access or transaction signing.
- All 84 Hardhat tests, compilation, and every PR check passed. PR #75 merged as
  `5570c959c4dc746a5fdae28c859318d963b0a7ae`; no contract deployment was executed.
- Recorded the deployment toolchain's full transitive audit findings rather than relying only on the empty
  production-dependency result.
- Formally blocked AWS-specific PR #78 from merge and requested a provider-neutral, non-AWS signer redesign.
- Live bridge remains enabled and swap remains disabled/unavailable.
- Updated by: `bachal-mb`.

### 2026-08-14 — MX-05 gates merged and deployed; Quantt owner inputs remain

- PR #88 passed every required/reporting check and merged as
  `c01ec48472544270ec0716483e5a07bba947b079` by `bachal-mb`.
- Protected deployment run `31828985116` published and deployed that exact core release and passed the public health
  gate without touching the faucet.
- Post-deployment probes confirmed the Quantt page is available while its API remains safely unconfigured: status
  exposes no origin and insights return HTTP 503.
- MX-05 is now an external blocker on the canonical API contract/credential, developer TLS repair or approved
  replacement, product decisions, exact schema implementation, live tests, and owner acceptance.
- Updated by: `bachal-mb`.

### 2026-08-14 — MX-05 verified and assumption-based activation removed locally

- Reverified the deployed adapter is disabled, the research portal is healthy, and standards-valid access to
  `dev.quantt.at` fails hostname verification.
- Inspected the presented certificate: it covers `quantts.ai` hosts, not the requested `dev.quantt.at`. The similar
  domain was observed but deliberately not substituted without Quantt-owner approval.
- Changed local configuration loading to require an explicit approved auth header and insights path rather than
  defaulting to an assumed Bearer scheme and `/api/v1/insights`.
- Added `docs/integrations/quantt.md` with verified evidence, exact owner inputs, activation sequence, acceptance
  criteria, and approval fields.
- Five focused Quantt tests, all 164 API tests, and the strict TypeScript build passed.
- Updated by: `bachal-mb`.

### 2026-08-14 — MX-04 merged and deployed; owner acceptance remains

- PR #86 passed every required/reporting check and merged as
  `c5448da8c617cf06083f9c08be7e08bd1b5cb6b2` by `bachal-mb`.
- Protected deployment run `31826844798` published the immutable image, recreated only the core explorer services,
  and passed the public health gate. The faucet remained outside the deployment.
- The public API reports the exact release SHA; home and blocks return 200; the shipped explorer bundle contains the
  new malformed-name validation; and fresh chain probes reconfirmed `makalu.litho` and `faucet.litho`.
- MX-04 is now an external blocker: the DNNS owner must confirm the supported interface, correct the public docs,
  supply one reverse fixture, approve the cache policy, and record acceptance.
- Updated by: `bachal-mb`.

### 2026-08-14 — MX-04 deployed interface verified and explorer hardened

- Traced the explorer configuration to the deployed Kamet v0 metadata instead of assuming the public reference
  documentation represented a live migration.
- Confirmed registry bytecode and all nine reserved forward records directly on chain. The deployed reverse node is
  unset, so reverse acceptance remains an owner action rather than an explorer code task.
- Removed process-lifetime record caching, enforced the deployed 2LD normalization rules, distinguished resolver
  outages from missing records, and required forward verification before displaying a reverse name.
- Added the evidence and owner sign-off fields in `docs/dnns-acceptance.md`.
- All 134 explorer tests passed. Next compilation, type validation, and static generation passed; the final local
  standalone-copy step remains blocked by Windows symlink policy and will be rechecked by Linux CI.
- Updated by: `bachal-mb`.

### 2026-08-14 — MX-03 merged and deployed; wallet acceptance remains

- PR #83 passed all checks and merged as `6ded419ca7034f9ded110255dd1a2683d3399029`.
- Deployment run `31819790372` served the new release and passed the explorer routes, but the core workflow also
  required the intentionally undeployed MX-02 faucet schema. The gate failed and automatic rollback succeeded.
- Verified the protected host scripts deploy only explorer, API, and indexer. Updated the repository copies and CI
  gate to match that isolation; PR #84 passed all checks and merged as `4fdb3ca5a4bcb0d24978189ce158028ae6247984`.
- The first PR #84 deployment attempt hit a transient GHCR `EOF` before recreation and rolled back successfully.
  Attempt 2 passed the public gate and deployed the expected release to explorer, API, and indexer.
- Public probes returned 200 for `/signin`, `/nfts`, stats, and nonce issuance. The live faucet retained its prior
  image and 2026-06-20 start time, confirming it was not part of the deployment.

### 2026-08-14 — MX-03 repository verification and wallet-team handoff

- Verified the currently published Chrome extension as `0.9.33` and checked its matching source instead of assuming
  compatibility from the newer unreleased repository version.
- Added a `window.thanos` fallback matching the official provider surface and automated both that path and late
  EIP-6963 announcement discovery.
- Verified the Makalu production session-secret gate without printing the secret and probed the live authentication
  routes.
- Added `docs/thanos-wallet-acceptance.md` with the exact remaining browser, restart, transaction, evidence, and
  approver fields. MX-03 remains open until the wallet team completes that record.

### 2026-08-14 — MX-02 secured image pipeline merged; production held safely

- PR #82 merged to `main` as `f6303f9d39f3c8075284dc73ecb65d4b3556e7eb` after all 13 PR checks passed.
- A faucet-only candidate exposed `CVE-2026-59873` in npm's bundled `node-tar`; runtime package managers were removed
  and the image passed a fresh CRITICAL Trivy gate before publication.
- Changed image publishing to build and scan locally before pushing, preventing future fixable CRITICAL findings
  from being published by the workflow.
- Merged image run `31814888627` completed all four services; the faucet image was signed, provenance-attested, and
  supplied with an SBOM at digest `sha256:34391877a9029461dfc261ce1ed0704b791d19f9065c0367a297952e49be12d8`.
- Confirmed faucet releases remain manual and no production deployment ran for the merge.
- Production remains blocked on funding-key rotation, protected-wrapper installation, treasury replenishment, live
  claims, and alert ownership.
- Updated by: `bachal-mb`.

### 2026-08-14 — MX-02 safeguards merged; deployment gap identified

- PR #80 merged to `main` as `ef5092812cddc591836657cea6197f8aa2f46fac`; all reported PR checks/statuses passed.
- Confirmed the live faucet still serves the prior payload after merge.
- Confirmed `publish-images.yaml` excludes the faucet, `deploy-simple.yaml` does not trigger on faucet changes, and
  the protected VPS deploy/rollback wrapper currently covers only web/API.
- MX-02 advanced from merge review to an external deployment-infrastructure blocker; funding, live claims, and
  per-token alert ownership remain open.
- Updated by: `bachal-mb`.

### 2026-08-14 — Sequential closure tracking and MX-02 repository safeguards

- Revalidated all seven streams against `origin/main`, open PRs, protected workflows, and live endpoints.
- Updated MX-06 with installed restricted monitor/backup identities, active chain monitoring, and the exact
  `BACKUP_RECIPIENT` custody blocker.
- Completed the local MX-02 fail-closed availability slice and added seven passing tests covering zero,
  below-minimum, malformed, balance-read failure, fractional precision, funded amount filtering, and successful
  route behavior.
- Faucet strict TypeScript build passed.
- MX-02 remains open at the merged/deployed/accepted gates: review, deployment, treasury replenishment, ten live
  claims, alert routing, and replenishment ownership are not complete.
- Updated by: `bachal-mb`.

### 2026-08-03 — Initial living handoff

- Consolidated repository, live-service, dependency, acceptance, and release state for all seven streams.
- Detected that `/api/quantt/status` changed from the July 22 HTTP 404 observation to HTTP 200, but remains
  intentionally unconfigured.
- Reconfirmed live bridge enabled and swap disabled.
- Reconfirmed every configured LEP100 faucet asset is below the minimum claim amount.
- Updated verification counts to API 163 passing tests and explorer 126 passing tests.
- Recorded the local-only delivery risk for DEX contracts/scripts, faucet safeguards, validator audit assets, and the
  expanded developer toolchain/CI.

## Update template

Append one entry whenever a material fact changes:

```markdown
### YYYY-MM-DD — MX-0N short description

- Previous gate/status:
- New gate/status:
- What changed:
- Evidence (PR/commit/release/deploy/test/approval):
- Remaining blocker or next action:
- Updated by:
```
