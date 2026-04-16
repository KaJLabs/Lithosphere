# Lithosphere Makalu (Testnet) — Phase Completion Tracker

> Last updated: 2026-03-06
> Context: Assessed against "L1 Developer Infrastructure Engineer Work Scope" PDF
> Scope: Makalu testnet (EC2 + Docker Compose deployment, NOT K8s)

---

## Summary Scorecard

| Phase | Name | % | Status |
|-------|------|---|--------|
| 0 | Discovery & Architecture | 100% | Done |
| 1 | Source Control & Repo | 100% | Done |
| 2 | CI Foundations | 100% | Done |
| 3 | Artifact & Package Mgmt | 100% | Done |
| 4 | GitOps CD & Promotion | 100% | Done |
| 5 | Developer Local Env | 100% | Done |
| 6 | Test Strategy | ~5% | CRITICAL GAP |
| 7 | Contract Tooling | ~30% | Partial |
| 8 | SDKs & DX Portal | ~35% | Partial |
| 9 | Observability | ~70% | Mostly done |
| 10 | Security & Compliance | ~25% | Partial |
| 11 | Governance | ~0% | Not started |

---

## Phase 0 — Discovery & Architecture (100%)

- [x] Languages/toolchains inventoried (Node/TS, Solidity/Hardhat, pnpm, Turbo)
- [x] Environments defined (.env.local, .env.testnet, .env.mainnet)
- [x] Core stack picked (GitHub Actions, Docker Compose, Prometheus/Grafana)
- [x] Architecture diagrams (14 in docs/diagrams/)
- [x] RACI matrix — `Makalu/docs/governance/security-baselines.md` section 3
- [x] Security baselines (aspirational) — `Makalu/docs/governance/security-baselines.md` sections 1-2
- [x] Security baselines (Makalu-enforced) — `Makalu/docs/architecture/004-security-baselines-makalu.md`
- [x] Promotion gates — `Makalu/docs/architecture/003-promotion-gates.md`
- [x] Phase 0 sign-off checklist — `docs/phase-0/SIGNOFF.md`

## Phase 1 — Source Control & Repo Strategy (100%)

- [x] Monorepo with pnpm workspaces + Turbo
- [x] contracts-template — real (compiled artifacts, tests)
- [x] service-template — Fastify, health/ready/metrics, OTel tracing, Dockerfile, README (entry: `src/server.ts`)
- [x] sdk-template — dual ESM/CJS via tsup, retry/backoff, publishConfig, README
- [x] create-litho-app CLI — fully functional
- [x] CODEOWNERS + ESLint + Prettier
- [x] PR template — `.github/PULL_REQUEST_TEMPLATE.md`
- [x] GitHub developer-preview release workflow — validation + packed CLI/SDK tarballs + contract bundles in `release.yaml`

## Phase 2 — CI Foundations (100%)

- [x] ci.yaml with pnpm/node_modules/Turbo caching — parallel jobs (build, lint, test, typecheck, gitleaks)
- [x] Turbo pipeline (build/test/lint with --filter)
- [x] Gitleaks secret scanning in CI
- [x] Contract pipeline — `ci-contracts.yaml` (compile, test, lint, gas report, slither, ABI export)
- [x] Services pipeline — SBOM in release.yaml; vitest + smoke tests added to api and indexer
- [x] SDK pipeline — `ci-sdk.yaml` (test on Node 18/20/22 LTS matrix, build, lint, typecheck, size check)
- [x] Parallelization — ci.yaml split into parallel jobs; contract CI has 6 parallel jobs; SDK uses matrix strategy
- [x] Test summaries posted to PR — `$GITHUB_STEP_SUMMARY` in all CI workflows
- [x] Flaky-test quarantine strategy documented in `docs/guides/ci-cache-strategy.md`
- [x] Cache strategy doc — `docs/guides/ci-cache-strategy.md`
- [x] API + Indexer test scripts — vitest with health smoke tests (turbo run test no longer a no-op)

## Phase 3 — Artifact & Package Management (100%)

- [x] Docker image build & push (publish-images.yaml — 3 images, semver + sha tags)
- [x] Cosign image signing (publish-images.yaml)
- [x] SBOM generation SPDX (publish-images.yaml)
- [x] GitHub prerelease package bundles — `@lithosphere/sdk` + `create-litho-app` packed as release assets; npm publish deferred
- [x] Contract versioned artifacts — ABI/bytecode/metadata tarball + SHA256 checksums uploaded to GitHub Releases
- [x] OCI registry — GHCR with semver tags (`1.2.3`, `1.2`), sha-based immutable tags, retention policy
- [x] Immutable artifact conventions + retention policy — `docs/guides/consuming-releases.md`
- [x] "How to consume releases" guide with cosign verification commands

## Phase 4 — GitOps CD & Environment Promotion (100%)

- [x] deploy-simple.yaml — SSH via bastion to EC2, docker compose up (WORKING)
- [x] deploy.yaml — full pipeline with SLSA + image tagging (WORKING)
- [x] Health monitoring — health-monitoring.yaml cron every 5 min
- [x] K8s/ArgoCD — N/A, out of scope for Makalu (production is EC2 + Docker Compose)
- [x] Kustomize overlays — N/A, out of scope for Makalu
- [x] Blue/green deploy — `Makalu/scripts/blue-green-deploy.sh` (Docker Compose based)
- [x] Automated rollback — rollback jobs in both deploy workflows + rollback snapshots saved pre-deploy
- [x] Formal staging->mainnet approval flow — `promote.yaml` with GitHub Environment protection rules
- [x] Rollback script — `Makalu/scripts/rollback.sh` for manual rollback
- [x] Promotion & rollback playbook — `docs/guides/promotion-playbook.md`

## Phase 5 — Developer Local Environment (100%)

- [x] `make up` one-command stack with health checks
- [x] docker-compose.dev.yml with LithoVM/Anvil (7 services incl. faucet)
- [x] seed-local.ts (27KB) — funds wallets, deploys LEP100, generates transfers
- [x] .env profiles (local, testnet, staging, mainnet)
- [x] VS Code devcontainers (root + Makalu)
- [x] VS Code workspace config — `.vscode/settings.json`, `launch.json` (debugger attach), `extensions.json`
- [x] Onboarding doc (docs/quickstart/dev-setup.md — thorough)
- [x] Makefile targets (up, down, clean, logs, seed, status, restart, dev, test, faucet-fund, help)
- [x] Faucet service — `Makalu/faucet/` (Fastify + viem, Redis rate limiting, HTML frontend)
- [x] Faucet in production compose — `docker-compose.yaml` with Traefik routing
- [x] `make dev` — one-command full setup (up + seed + endpoints)

## Phase 6 — Test Strategy & Ephemeral Environments (~5%) — CRITICAL GAP

- [ ] Unit tests — ZERO test files in API, indexer, explorer
- [ ] Integration tests — none
- [ ] E2E tests — none
- [x] Contract template tests — LithoBase.test.ts + LithoBase.t.sol in template
- [ ] PR-based preview environments — not implemented
- [ ] Data fixtures / chain state replayers — not implemented
- [ ] Test coverage dashboard — not implemented
- [ ] Flake tracker / quarantine — not implemented

## Phase 7 — Contract Tooling & Safety Rails (~30%)

- [x] Hardhat config in contracts/ and contracts-template/
- [x] Solidity contracts (LEP100, WLITHO, LITHONative) in Makalu/contracts/src/
- [x] Foundry config (foundry.toml in contracts-template)
- [x] Slither config (.slither.config.json) — NOT wired to CI
- [x] Gas reporter configured in hardhat — REPORT_GAS=false, not in CI
- [ ] Deployment framework (multi-sig, Ledger, EIP-712) — basic deploy.ts only
- [ ] ABI -> SDK auto-publish — not implemented
- [ ] solidity-coverage — installed but not in CI

## Phase 8 — SDKs & DX Portal (~35%)

- [ ] @lithosphere/blockchain-core — 100% STUBS (every module is `export {}` with TODOs)
- [ ] SDK typed ABIs, retry/backoff — not implemented
- [ ] Auto-publish on release (npm) — not implemented
- [x] Developer docs portal — Docsify site, 48 markdown files, docs-deploy.yml
- [x] Code samples — docs/developers/examples/ (hardhat, foundry)
- [ ] wagmi/ethers frontend samples — not implemented
- [ ] OpenAPI/GraphQL schema auto-gen — not implemented

## Phase 9 — Observability, Quality & Cost (~70%)

- [x] Prometheus config + lithosphere-alerts.yml
- [x] 7 Grafana dashboards (JSON, provisioned)
- [x] Loki + Promtail configs
- [x] AlertManager config with routing
- [x] Node exporter (deploy script + compose service)
- [x] health-monitoring.yaml (cron every 5 min)
- [x] monitoring-diagnostics.yaml workflow
- [ ] SLO dashboard — not implemented
- [ ] Cost dashboard — not implemented
- [ ] Correlation IDs (commit->build->deploy->trace) — not implemented

## Phase 10 — Security, Compliance & Supply Chain (~25%)

- [x] AWS OIDC federation (no long-lived keys in CI)
- [x] Gitleaks secret scanning in CI
- [x] Cosign image signing (release + publish-images)
- [x] SBOM SPDX generation (release workflow)
- [ ] Image/dependency scanning (Trivy/Snyk) — not implemented
- [ ] License allow/deny policy — not implemented
- [ ] Policy as code (OPA/Conftest) — not implemented
- [ ] Key rotation playbook — not documented
- [ ] Audit trail -> SIEM — not implemented

## Phase 11 — Governance & Change Management (~0%)

- [ ] Release trains (weekly dev, bi-weekly staging, on-demand hotfix)
- [ ] RFC process / template
- [ ] CAB approvals for mainnet
- [ ] PIR template
- [ ] Release calendar

---

## Out of Scope (for Makalu testnet)

| Item | Reason |
|------|--------|
| Terraform/IaC (VPC, RDS, clusters) | Lives in litho-validator-infra repo |
| K8s cluster provisioning | Production is EC2 + Docker Compose |
| ArgoCD server deployment | SSH-based CD in use |
| Vault/KMS | AWS Secrets Manager used instead |
| Self-hosted CI runners | GitHub-hosted sufficient at current scale |
| SIEM integration | Enterprise requirement, premature for testnet |
| Multi-AZ / HA deployment | Single EC2 for testnet |
| CDN (CloudFront) | Not needed for testnet |
| Nix flakes | Docker Compose chosen |
| Binary releases for CLIs | create-litho-app is npm-distributed |

---

## Priority Actions (Next Steps)

1. **Phase 6 — Write deeper tests** for API, indexer, explorer (smoke tests added; need integration/E2E)
2. **Phase 8 — Implement blockchain-core SDK** or remove stubs
3. **Phase 10 — Add Trivy/Snyk** to CI for dependency scanning
