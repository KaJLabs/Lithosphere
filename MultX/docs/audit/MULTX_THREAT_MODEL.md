# MultX Bridge — Threat Model

> Historical bridge model. For current 3-of-5 quorum and native/quote/custody risks, see [NATIVE_CANDIDATE_THREAT_MODEL.md](NATIVE_CANDIDATE_THREAT_MODEL.md). Older 5-of-7 statements below are historical, not current activation policy.

> **Current architecture notice (2026-08-19):** LITHO mainnet uses Cosmos ID
> `lithosphere_9005-1` and EVM chain ID `9005`. MultX remains disabled. The
> current production candidate uses five independent signer VPSs with a 3-of-5
> threshold, distinct
> mounted keys, fsync-backed anti-equivocation journals and direct mTLS
> endpoints. The contracts and this off-chain signer
> protocol require independent review before MultX can be enabled. Historical
> Kamet deployment details remain for provenance.

**Last reviewed:** 2026-08-19
**Audience:** External security audit firm + internal review
**Repo:** `KaJLabs/Lithosphere` (`MultX/contracts/contracts/MultXBridge.sol`)
**Companion docs:**
- Slither pre-audit report: [`slither-pre.txt`](./slither-pre.txt)
- Current (Kamet testnet) deployment: [`contracts/deployments/kamet-bridge-hardened-2026-05-09T18-03-58-093Z.json`](../../contracts/deployments/)

---

## 1. System Overview

MultX is an N-of-M signature bridge between LITHO mainnet (source/canonical
chain, EVM `9005`) and Ethereum, BNB Chain, and Base mainnets. Historical
Kamet/Makalu and external testnet deployments are retained only as test
evidence; their addresses are not production defaults.

### 1.1 Forward flow (LITHO mainnet → destination chain)

```
User                  MultXBridge (LITHO)         Validator service        MultXBridge (dest)
 │                          │                            │                         │
 │  approve(bridge, amt)    │                            │                         │
 │ ───────────────────────► │                            │                         │
 │                          │                            │                         │
 │  lockTokens(token, amt,  │                            │                         │
 │  targetChain)            │                            │                         │
 │ ───────────────────────► │                            │                         │
 │                          │ TokensLocked event         │                         │
 │                          │ ──────────────────────────►│                         │
 │                          │                            │ sign(keccak(...))       │
 │                          │                            │ ×N validators           │
 │                          │                            │                         │
 │                          │                            │ submit sigs to dest     │
 │                          │                            │ ───────────────────────►│
 │                          │                            │                         │ releaseTokens(...)
 │                          │                            │                         │ → mint wrapped
 │ ◄──────────────────────────────────────────────────────────────────────────────│
 │  user receives wrapped LEP100 on dest chain                                    │
```

### 1.2 Reverse flow (destination chain → LITHO mainnet)

```
User                  MultXBridge (dest)         Validator service       MultXBridge (LITHO)
 │  approve(bridge, amt)    │                            │                         │
 │ ───────────────────────► │                            │                         │
 │                          │                            │                         │
 │  lockTokens(wrapped,     │                            │                         │
 │  amt, 9005)              │                            │                         │
 │ ───────────────────────► │                            │                         │
 │                          │ TokensLocked event         │                         │
 │                          │ ──────────────────────────►│                         │
 │                          │                            │ sign(..., source=dest)  │
 │                          │                            │                         │
 │                          │                            │ submit sigs to LITHO    │
 │                          │                            │ ───────────────────────►│
 │                          │                            │                         │ releaseTokens(...)
 │ ◄──────────────────────────────────────────────────────────────────────────────│
 │  user receives original LEP100 back on LITHO mainnet                           │
```

### 1.3 Contracts in scope

| Contract | Code lines | Physical lines | Purpose | Storage |
|---|---:|---:|---|---|
| `MultXBridge.sol` | — | — | Source-chain lock + release (LITHO) | validator/replay state plus independent fixed-window lock and release volumes |
| `MultXBridgeDest.sol` | — | — | Destination-chain lock(burn) + release(mint) | same controls as `MultXBridge`; burns on locks and mints on releases |
| `WrappedLEP100.sol` | — | — | Wrapped representation on destination chains | OZ ERC20 + ERC20Burnable; one immutable bridge minter and no administrator |

### 1.4 Contracts out of scope (don't audit, don't bill)

- `LEP100Token.sol` — canonical LEP100 tokens on Kamet. Already deployed, immutable. Standard ERC20.
- DEX contracts (`contracts/dex/`) — Uniswap v3 fork, separately auditable; not part of bridge surface area.
- DNNS contracts (`contracts/dnns/`) — ENS fork; not part of bridge surface area.
- Faucet contracts — internal-only testnet helper.

---

## 2. Trust Assumptions

| # | Assumption | What we mitigate / accept |
|---|---|---|
| T1 | Bridge signer key custody is secure | Each independent signer VPS holds one owner-restricted mounted secp256k1 key. The API holds no validator private keys. Direct TLS 1.3 mutual authentication restricts API-to-signer traffic. Review `MultX/signer/`, `api/src/services/remoteSigner.js`, and `docs/VPS_SIGNER_ARCHITECTURE.md`. |
| T2 | At least `signaturesRequired` bridge signers (current candidate: **3 of 5**) act honestly | This is the core security assumption. A quorum can authorize false releases, but every supported production asset must have a positive fixed-window outbound cap. The candidate set is not active on mainnet yet. |
| T3 | LITHO mainnet itself remains within its BFT safety assumptions | Bridge security inherits chain security. LITHO runs CometBFT consensus with a consensus validator set that is separate from the five current-candidate MultX bridge signers. |
| T4 | Source-chain RPC providers return honest state to bridge signers | Every signer queries its configured RPC and verifies the exact event and confirmation depth. Quorum does not provide independence if multiple signers share the same compromised upstream; endpoint/provider diversity must be reviewed before activation. |
| T5 | Compiler (`solc 0.8.24` with optimizer runs=200) is sound | Standard assumption; well-known compiler, widely used. |
| T6 | OpenZeppelin contracts (Pausable, ReentrancyGuard, SafeERC20, ERC20Burnable) are sound | OZ audited and battle-tested. |
| T7 | The owner key (setValidatorSet/setDailyCap/addSupportedToken/unpause) is custodied securely | Target: **owner = TimelockController (48h) governed by an M-of-N Gnosis Safe** (ADR-0004), with a separate fast `pauseGuardian`. Built + tested; live transfer scheduled for production cutover (client decision — see L1). Until then the live owner is the deployer EOA. |

---

## 3. Adversary Models

### 3.1 Malicious validator subset (size < signaturesRequired)

**Capability:** sign attestations, withhold attestations, sign equivocating attestations.

**Impact:** None directly — under the N-of-M threshold, no minting/release possible. Their signatures contribute to nothing on their own.

**Mitigation:** N-of-M threshold + ordering check (`signer > lastSigner` in `releaseTokens`) prevents the same key being counted twice.

### 3.2 Malicious validator subset (size ≥ signaturesRequired)

**Capability:** sign release of arbitrary amounts of wrapped tokens on destination chains without a corresponding lock on the configured source chain (or vice versa).

**Impact:** Can authorize a false canonical transfer or wrapped-token mint. Each
bridge enforces the configured positive per-token cap on releases in an
independent fixed 24-hour window. This bounds, but does not eliminate, quorum
compromise losses before detection and pause.

`WrappedLEP100` has no administrator or role-grant path. Its single immutable
`bridge` address is the only caller that can mint, eliminating the separate
administrator bypass identified as Autha C-01.

**This is the core trust boundary.** Mitigated only by:
- Validator set composition (independent operators, ideally not all under one legal/operational entity)
- Per-signer VPS/account isolation, direct mTLS boundaries, fsync-backed
  anti-equivocation records, and signer-local policy checks make a
  quorum compromise materially harder
- Fixed-window caps (`dailyCap[token]`) independently constrain locks and releases; a boundary burst can approach 2x the configured cap and is included in policy sizing
- Emergency pause — owner can halt all bridge operations within one block of detection

### 3.3 Malicious user / external attacker

**Capability:** call any external function, submit any calldata, replay-attack with old signatures, race-condition exploits.

**Specific attempted attacks and current defenses:**

| Attack | Defense |
|---|---|
| Re-use signed release for the same source-bridge nonce twice | `processedNonces[sourceChain][sourceBridge][sourceNonce]` is set on first execution; subsequent calls for that exact source bridge revert |
| Submit duplicate signatures to inflate count | Signature ordering check: `require(signer > lastSigner, "Signatures must be in ascending order")` |
| Submit signatures from unknown signer | `require(isValidator[signer], "Invalid signer")` |
| Reentrancy on `releaseTokens` (try to recurse during `safeTransfer`) | `nonReentrant` modifier from OZ ReentrancyGuard |
| Lock 0 amount to create spam events | `require(amount > 0, "Amount must be greater than 0")` |
| Lock to current chain (no-op bridge) | `require(targetChain != block.chainid)` |
| Bridge unsupported token | `require(supportedTokens[token], "Token not supported")` |
| Bridge an approved token to an unsupported chain | `supportedRoutes[token][targetChain]` must be explicitly enabled by governance; the listener quarantines historical/unmapped events and advances its durable cursor |
| Admit fee-on-transfer or rebasing semantics | Source escrow verifies its exact post-transfer balance delta; asset policy separately prohibits rebasing, reflection, callback-bearing and other non-standard balance behavior |
| Exceed lock or release cap | Per-token fixed 24h windows separately enforce `dailyVolume + amount <= dailyCap` and `releaseVolume + amount <= dailyCap` |
| Front-run or malleate an in-flight signature submission | Signatures bind `(sourceTxHash, sourceBridge, token, user, amount, sourceChain, sourceNonce, destinationChain, destinationBridge)`; OpenZeppelin ECDSA rejects non-canonical high-s signatures, and only the bound recipient receives funds |
| Burst across a cap-window boundary | Explicitly accepted fixed-window behavior; policy must size caps for a potential near-2x boundary burst and monitoring must alert before exhaustion |

### 3.4 Malicious bridge owner

**Capability:** pause bridge, change validator set, raise/lower caps, add/remove tokens.

**Impact:** Can halt all bridge operations (pause), can replace validators with attacker-controlled keys (then drain via T2.2), can raise daily caps to enable a single-day drain.

**Mitigation:** owner becomes a Safe→Timelock(48h) at production cutover; guardian (pause-only) already in code. Currently a single deployer key on the live bridge — **see L1 below** (mitigation built, transfer deferred to production per client).

### 3.5 Compromised RPC provider used by validator service

**Capability:** lie to a single validator about chain state.

**Impact:** that validator either signs an invalid attestation (caught by other validators refusing) or fails to sign valid attestations (degrades signing throughput but doesn't break safety).

**Mitigation:** each signer verifies state using its configured RPC. Production
approval must record provider/endpoint diversity so one compromised upstream
cannot supply identical false state to a quorum. Audit firm: please assess the
minimum acceptable diversity and failure policy.

---

## 4. Asset Flow Invariants

For each LEP100 token `T` and each chain pair (LITHO source, destination):

1. **Conservation (steady state):**
   ```
   sum(T balance of LITHO bridge) >= sum(T minted on dest) - sum(T burned on dest)
   ```
   Or in plain terms: tokens locked on LITHO must always cover tokens currently
   minted on the destination chain. If users have wrapped tokens on a
   destination chain, the original tokens on LITHO should be held by the bridge
   contract.

2. **Nonce monotonicity:** `nonce` strictly increases per chain. `processedNonces[srcChain][srcNonce]` is one-way (false → true, never reverted).

3. **Signature attribution:** every release event is attributable to exactly the validators whose signatures the call provided.

4. **No partial reverts:** all state changes in `lockTokens` and `releaseTokens` either fully apply or fully revert (covered by ReentrancyGuard + Solidity's atomicity).

5. **Pausable atomicity:** `pause()` blocks any new `lockTokens` / `releaseTokens` until `unpause()`. Already in-flight transactions on chain still complete (no force-revert), but no NEW txs can be initiated.

### Invariant testing recommendation

Audit firm: please test these with Foundry / Echidna invariant tests. Suggested invariants for the testing harness:

```solidity
// Echidna-style invariants
function invariant_no_double_release() public view {
  for (each sourceChain, sourceBridge, sourceNonce) {
    assert(processedNonces[sourceChain][sourceBridge][sourceNonce] == true || release_for_that_nonce_count == 0);
  }
}

function invariant_signer_ordering() public {
  // Crafted release with duplicate sig should always revert
}

function invariant_pause_blocks_lock() public {
  pause();
  vm.expectRevert();
  lockTokens(...);
}
```

---

## 5. Known Limitations (accepted for v1 — flagged for audit attention)

| # | Limitation | Why accepted for v1 | Plan for v2 |
|---|---|---|---|
| L1 | Owner is a single EOA, not a multisig — **MITIGATION BUILT, transfer deferred to production** | The Safe + TimelockController(48h) + guardian design is implemented and tested (`Governance.integration.test.js`), and the migration tooling is ready. Per client decision (2026-06-20), the **live** Kamet bridge stays under the deployer EOA through audit/testnet (test wallets used for rehearsal); ownership is transferred to the client-held M-of-N Safe at production cutover (M4.6). See ADR-0004 + `docs/operations/GOVERNANCE_MIGRATION.md`. | Execute live ownership transfer at production cutover |
| L2 | No economic slashing of misbehaving validators | Out of scope for v1; bridge can rotate via `setValidatorSet` instead | Optional: stake LITHO via separate contract that can slash on equivocation proof |
| L3 | Validator service uses one signature coordinator (`MultX/api`), not a P2P mesh | The coordinator cannot forge signatures and each signer independently validates the source event, confirmations, bridge and route. A coordinator outage can halt transfers, but cannot satisfy the quorum. | Add redundant coordinators or P2P aggregation if availability requires it |
| L4 | Cross-destination replay — **resolved in audit candidate** | The signed hash now includes `block.chainid` and `address(this)`. Signer policies also bind the release bridge. Contract, API and signer tests reject reuse on a different chain/bridge. Independent audit confirmation remains required. |
| L5 | Caps use fixed 24-hour windows, not rolling windows | Boundary behavior can allow nearly 2x the nominal cap in a short interval; this is documented and must be included in approved cap sizing | A future rolling-bucket implementation may reduce burst allowance |
| L6 | Pause guardian == owner — **RESOLVED in code** | Dedicated `pauseGuardian` role added: a fast ops key can `pause()` without holding owner rights; `unpause()`/config stay owner-only. Proven in `contracts/test/Governance.integration.test.js`. The live `pauseGuardian` is assigned during the governance wiring at production cutover (address(0) until then → pause is owner-only, as today). | Assign guardian at cutover |
| L7 | No on-chain `setSignaturesRequired` independent of `setValidatorSet` | `setValidatorSet` always takes both; intentional to prevent inconsistent state | None |

---

## 6. Out-of-scope items the audit shouldn't bill for

To keep the audit scoped tightly and the fee predictable:

- **Uniswap v3 fork** in `contracts/dex/` — separate audit scope if/when needed
- **ENS fork (DNNS)** in `contracts/dnns/` — separate audit scope if/when needed
- **Faucet** scripts and contracts — testnet helper only, doesn't hold mainnet funds
- **Indexer + bridge-api business logic** in `bridge-api/` — not on-chain code; assess via separate ops security review
- **Validator signer infrastructure** (VPS hardening, private routing, host
  firewall, mounted-secret custody, backups and monitoring) — separate
  operations review; the signing protocol itself still requires
  application-security review
- **Frontend** (`kamet-explorer`) — not security-critical; users can always interact directly with the contract

---

## 7. Open questions for the audit firm

We'd like the audit to specifically opine on:

1. **Signature scheme:** confirm that the EIP-191 hash, now explicitly bound to destination `block.chainid` and `address(this)`, plus ordered-signer enforcement is robust against malleability and cross-domain replay. Advise whether EIP-712 is still required.
2. **Cap semantics:** confirm the documented fixed-window boundary behavior and
   the independent outbound release limiter adequately address M-04.
3. **Pause behavior on `releaseTokens`:** if a release is mid-execution when pause is called, does it complete? Should it?
4. **Validator set rotation:** when `setValidatorSet` is called, any release tx not yet executed will reject signatures from the old set. Is this the desired behavior, or should there be a grace period? Recommend documenting this in operator runbook.
5. **Dest-chain wrapped token (`WrappedLEP100`):** confirm its immutable bridge-only mint authority closes C-01 without introducing a new administrator path.

---

## 8. Deployment & operational context

### Current deployment (Kamet testnet — mainnet launch pending this audit)

- Contract: `0x3a896BDF3a1088287FA84aB5a43bB30e2535F263` (live on Kamet, chainId 900523, **testnet**)
- Deployed: 2026-05-09 (hardened version with Pausable, setValidatorSet, daily caps)
- Owner: deployer EOA `0x10ed4F004Fe708014ae27Bcc20c9Ed9df3f4eadF` (unchanged). The Safe + Timelock(48h) + guardian migration is built and tested; per client decision (2026-06-20) the live ownership transfer to the client-held M-of-N Safe happens at **production cutover** — test wallets are used for any pre-production rehearsal. The guarded contract (with `pauseGuardian`) is what the audit reviews and what deploys at cutover.
- Validators (7, **5-of-7 threshold**, migrated 2026-05-19 via atomic pause -> setValidatorSet -> unpause; no in-flight tx affected):
  - `#0 0xD9B30A7f4d58f1b98AaA69B82F0c8bF0816638FB`
  - `#1 0xEefB2E0c91Bc57975D117BADA6c70f3Cd6C4bC91`
  - `#2 0x4dFEd8e8359EaA711CdFFFcb5d994a66e46185Ac`
  - `#3 0x27026F8C232d723100700186c10B2aEbd82ea60C`
  - `#4 0xc8C5c89ddb70CAEC942f2C5A77F4F4001ef3B415`
  - `#5 0x4CDd6D160Bd79fe7d4Bab06a9E0607870e8108D9`
  - `#6 0xB161611185Ce2c95849134188AC9F5DbC26bfD2D`
- Validator keys: the historical Kamet deployment above uses seven signers. The
  current LITHO mainnet candidate instead requires exactly five independently
  operated signer VPSs with one mounted key and persistent decision journal
  per signer. Production rejects permissive or symlinked key/journal paths,
  non-mTLS transport and environment-supplied policy. Release signing remains
  disabled and no LITHO mainnet signer set is active on chain yet.

### Operational runbooks supplied to audit firm

- `docs/operations/BRIDGE_RUNBOOK.md` — pause procedure, validator-set rotation, daily-cap management, incident-response playbook (key compromise / suspected contract bug / RPC brownout)
- `docs/VPS_SIGNER_ARCHITECTURE.md` — current signer trust boundaries and launch gates
- `docs/audit/AUDIT_SIGNER_SOURCE_MANIFEST_2026-09-05.md` — non-AWS signer source boundary and checksums
- `docs/operations/VALIDATOR_KEY_ROTATION.md` — historical testnet procedures; not production authorization

---

## 9. Submission package checklist

Items the audit firm should expect at kickoff:

- [x] Contract source code (`contracts/contracts/MultXBridge.sol`, `MultXBridgeDest.sol`, `WrappedLEP100.sol`)
- [x] This threat model document
- [x] Slither 0.11.5 pre-audit report (`slither-pre.txt`) — refreshed 2026-08-19 over the immutable candidate; 13 results retained with engineering triage for independent review
- [x] Historical pre-remediation candidate tag (`multx-audit-candidate-v0.6.0-20260819`)
- [ ] New immutable Autha-remediation tag; create only after CI and merge, then require the firm to confirm its resolved commit
- [x] Hardhat test suite (`contracts/test/MultXBridge.test.js`, `MultXBridgeDest.test.js`, `WrappedLEP100.test.js`)
- [x] Deployment scripts (`contracts/scripts/02-redeploy-bridge-hardened.js`, `03-deploy-dest-chain.js`)
- [x] Operator runbooks (`docs/operations/BRIDGE_RUNBOOK.md`, `VALIDATOR_KEY_ROTATION.md`)
- [x] Non-AWS VPS signer candidate, architecture document and source manifest
- [ ] Independent review of the VPS signer protocol, mTLS boundary, mounted-key custody and persistent anti-equivocation procedure
- [x] Foundry invariant suite (`contracts/test/foundry/MultXBridgeInvariant.t.sol`) — solvency / release≤lock / nonce / threshold invariants over 16,384 fuzzed calls

---

*End of threat model. Questions / clarifications: contact infra team via the Litho project channel.*
