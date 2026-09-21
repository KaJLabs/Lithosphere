# MultX O-01 operational-readiness status

Date checked: 2026-09-21.

This receipt reconciles the newest independently reviewed MultX source identity with the latest sanitized operator
evidence. It is a status record, not deployment or activation authority. The source reports and infrastructure
packages remain in the controlled evidence store and are not reproduced in this public repository.

## Accepted source identity

- Candidate commit: `465f6868555ba528d1d9417885a791ae573bbd5a`
- Candidate name in the review package: `multx-consolidated-review-candidate-20260912`
- Candidate package: `MULTX_CONSOLIDATED_CANDIDATE_2026-09-12.zip`
- Candidate package SHA-256: `7a749b3e20afaeb8bc436647b1f5091cb68976a2a7c486695e5cd9fcdf8dd66a`
- Autha DOCX SHA-256: `bc7c590bd9d956500c03466809d684104caad90918a0e87b2ade19ff9ccdd9ec`
- Retained Markdown SHA-256: `22f21a6090064b65970ed99dca3c05d01cdb8461c19bfa2b044dc722e48c086a`
- Autha disposition: **SOURCE-LEVEL ACCEPTANCE APPROVED — ACTIVATION REMAINS GATED**

The supplied report accepts the consolidated 3-of-5 source candidate, including the pinned fallback-handler
amendment and inherited native verifier, RPC cache/reorg, and source-evidence controls. It closes G-01, G-04, and
L-03 at source level. The accepted commit is an ancestor of public `main`.

The review package calls the candidate name a **local tag**. No matching tag is published by the public
`KaJLabs/Lithosphere` remote as of this check, so this receipt binds acceptance to the exact commit and package
digest and does not claim a public tag exists. The accepted commit itself is unsigned; that existing GitHub
verification state is recorded rather than rewritten.

## Route decision evidence

- Technical route record: `CLIENT_ROUTE_APPROVAL_FILLED_DRAFT_2026-09-15.md`
- Record SHA-256: `64e412d5e1c1ac9a5de8f5d85ad78e02c0053474b2fb2cbb7970d1b5f1c96e60`
- Evidence archive: `MULTX_ROUTE_APPROVAL_2026-09-15.zip`
- Archive SHA-256: `53784ec2f97ee31abd898f3c4804a007eb0c77a19261706e70d6ca1bb17d00b7`

The record says the client approved the technical shape of six ETH/BNB/Base directions on 2026-09-15. It also
states that its durable approval URL is pending, its proposed caps and three-confirmation finality require their
own approval, and all deployment-derived addresses, runtime identities, pools, and funded liquidity remain absent.
The initial rollout is therefore ETH/BNB/Base-first; LITHO-origin routes are not part of this approval.

## Five-host baseline evidence

- Evidence archive: `MULTX_SIGNER_HOSTS_5_OF_5_2026-09-20.zip`
- Archive SHA-256: `1ad44c75ab36058a8990a72db0e75fd6c4e3778672c03659751b606b16c4778d`
- Baseline report SHA-256: `4c971a71bbdddbfce40aad33f63ee5c6c5248e778d8694977b4990dcc115cb6a`
- Host-4 retirement report SHA-256: `e7b47718fe05eff204a06b79a7b0f9a0b0256ba61250c9f25bf8203984bcd88d`
- Host-5 retirement report SHA-256: `6fb06c80aab3f6ccad31a94cafbe0f6f2278838b84063fcbd9abd838e47aba49`

The sanitized package reports five of five signer hosts baseline-prepared with firewalls and fail2ban active,
TCP/9443 blocked, signer processes and runtime absent, and release signing disabled. Hosts 4 and 5 were sanitized
in place and had their SSH host identities rotated; the reports explicitly state that provider-level OS reimages
were not performed. This evidence establishes fail-closed capacity only. It does not establish custodian
independence, key custody, mTLS, an approved signer image/policy, or a running disabled signer fleet.

## O-01 closure matrix

| Control | State | Evidence or exact next requirement |
| --- | --- | --- |
| Consolidated source and bytecode root | Accepted | Exact commit/package above; deployment must reproduce the accepted runtime hashes. |
| Staging provenance and isolation | Closed | P-01, P-03, P-05, O-15, and O-18 are closed in the retained Autha reports. |
| Five signer host capacity | Prepared, fail-closed | Five-host archive above; no signer runtime, keys, or certificates installed. |
| Signer custody and operator independence | Open | Confirm the five signer-to-host mappings; record independent custodians, management SSH public keys, and fixed management IP/CIDRs privately. |
| Coordinator-to-signer mTLS | Open | Provide the approved coordinator source allowlist and client CA through the private repository or secret manager. |
| Route approval provenance | Open | Preserve an authenticated durable reference for the 2026-09-15 decision and separately approve caps and finality. |
| Governance decisions | Open | Resolve or accept G-02, G-03, and O-12; assign the Base governance Safe, deployer, fee payer, pause guardian, liquidity/recovery owners, and activation authority. |
| Deployment-derived identities | Open | Generate reviewed paused-deployment plans, then record contracts, transactions, runtime hashes, routers, pools, token paths, and backing. |
| Application execution evidence | Open | Directly attest the executing `/app` tree (O-19) and perform the application-behavior rehearsal (O-14). |
| Operations | Open | Complete per-signer recovery, database/coordinator restore, monitoring, alert, rollback, and recovery drills. |
| Paused deployment and canary | Not authorized | Requires a separate written window and approvals after every preceding control is complete. |
| Activation | Disabled | Requires explicit final governance approval; MultX, Bridge signing, Swap, release relaying, and liquidity remain disabled. |

## Immediate owner input

The shortest safe next step is to complete the private signer-custody worksheet for the proposed mapping (Host 1
Coltre, Host 2 LiLe, Host 3 Ole, Host 4 MulVAL, Host 5 M MULTX), including each custodian/entity, SSH public key,
and fixed management IP/CIDR. The coordinator owner must also provide its source allowlist and mTLS client CA.
Private keys, passwords, certificates containing private keys, private endpoints, and secret values must not be
placed in chat or this repository.

Nothing in this receipt authorizes deployment, funding, unpausing, release signing, liquidity, canary, or
activation.

## Operator package update — 2026-09-22

The public 3-of-5 signer mapping, confirmed governance assignments, initial
ETH/BNB/Base scope and operator boundary are consolidated in
[`O01_OPERATOR_RESPONSIBILITIES.md`](../O01_OPERATOR_RESPONSIBILITIES.md).
The fail-closed rollback and re-entry sequence is recorded in
[`O01_ROLLBACK_PROCEDURE.md`](../O01_ROLLBACK_PROCEDURE.md). Chain owners and
custodians can complete the remaining opaque/private fields using
[`MULTX_O01_OWNER_INPUT_2026-09-22.md`](MULTX_O01_OWNER_INPUT_2026-09-22.md).

These documents close the missing operator-responsibility and rollback-document
preparation only. Custody evidence, coordinator mTLS inputs, authenticated
cap/finality acceptance, production inventory, operational drills, O-14/O-19,
paused-deployment authorization and independent O-01 acceptance remain open.
