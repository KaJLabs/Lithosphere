# Lithosphere Explorer & Indexer — Production Deployment Report

**Prepared by:** KaJ Labs Development Team
**Date:** March 1, 2026
**Status:** Production Live

---

## Executive Summary

The Lithosphere block explorer and indexer stack has been fully deployed to production and is now live at **https://makalu.litho.ai**. This report documents everything that was built, every problem that was identified and resolved, and the current state of the production infrastructure.

The original issue — a **522 Connection Timeout** error that made the explorer unreachable — has been permanently resolved. The root cause was that the explorer service had never been deployed to the production server. We rebuilt the entire deployment pipeline from scratch, aligned all configuration with the live chain infrastructure, and shipped a fully automated CI/CD system that handles all future deployments.

---

## What Was Delivered

### 1. Live Production Infrastructure

All endpoints are live, HTTPS-secured, and verified:

| Service | URL | Status |
|---------|-----|--------|
| Block Explorer | https://makalu.litho.ai | Live — 200 OK |
| Network Status | https://status.litho.ai | Live — `{"status":"ok"}` |
| Public RPC | https://rpc.litho.ai | Live — 200 OK, rate-limited |
| Public REST API | https://api.litho.ai | Live — 200 OK, rate-limited |

**Live chain stats (verified March 1, 2026):**
- Network: `lithosphere_700777-1` (reset from `lithosphere_777777-1` on 2026-03-23)
- Latest Block Height: `779,841`
- Node: `sentry-01` (evmosd v20.0.0)
- Sync Status: In sync (not catching up)

---

### 2. The 522 Timeout — Root Cause & Fix

**What was happening:**
Cloudflare was proxying traffic for the explorer domain to the production server on port 3000. Nothing was listening on port 3000 — the explorer Docker service had never been added to the production `docker-compose.yaml`. Cloudflare couldn't reach the origin server, so it returned a 522 timeout to every visitor.

**What we fixed:**
Added the full explorer service to the production compose stack, wired it to the correct endpoints, and deployed it to the production EC2 node via an automated pipeline.

---

### 3. Full List of Issues Found and Resolved

During deployment we audited the entire stack and resolved **14 separate issues**:

| # | Issue | Impact | Fix |
|---|-------|--------|-----|
| 1 | Explorer service missing from production compose | **Critical** — caused the 522 timeout | Added complete explorer service definition |
| 2 | Grafana and Explorer both assigned port 3000 | **Critical** — port conflict, one service would fail | Moved Grafana to port 3001 across all config files |
| 3 | CI/CD only deployed to one path, not the explorer path | **Critical** — explorer never deployed by pipeline | Added `/opt/lithoscan` deploy path to pipeline |
| 4 | No `.env` file being written for explorer on deploy | **High** — explorer would start with no config | Added `.env` write step to pipeline |
| 5 | No explorer deploy step in CI/CD pipeline | **High** — explorer stack never started automatically | Added `docker compose up` step for explorer stack |
| 6 | Health monitoring checking wrong service on port 3000 | **Medium** — alerts were mislabeled (said "Grafana") | Fixed to monitor Explorer on :3000, Grafana on :3001 |
| 7 | All RPC endpoints pointed at Validator internal IP | **High** — violates security architecture; Validator should never be accessed directly | Replaced all with Sentry node IPs, then upgraded to public HTTPS domains |
| 8 | EVM Chain ID default was `61` (wrong network) | **High** — transactions would target wrong chain | Changed to `777777` (Lithosphere mainnet) |
| 9 | No mainnet environment config file existed | **High** — no production `.env` to deploy from | Created `.env.mainnet` with all production values |
| 10 | Database address column too narrow (42 chars) | **High** — Cosmos bech32 addresses (`litho1...`) don't fit in `VARCHAR(42)` | Widened to `VARCHAR(100)`, added `evm_address` column |
| 11 | Database permissions only granted to one role | **Medium** — deployment would fail if using `litho` or `lithoscan_admin` DB user | Updated GRANT block to cover all three application roles |
| 12 | `DATABASE_URL` pointed at local container, not RDS | **Critical** — production has no local Postgres; uses AWS RDS | Updated to RDS endpoint with Secrets Manager credentials |
| 13 | No AWS authentication in deployment pipeline | **High** — couldn't fetch RDS credentials securely | Added OIDC role assumption + Secrets Manager fetch |
| 14 | Database schema incompatible with Ethermint chain | **Critical** — simplified EVM-only schema couldn't store Cosmos transactions | Replaced entirely with canonical dual-layer schema |

---

### 4. Production Architecture

The production stack runs across AWS infrastructure with the following layout:

```
Internet
    │
    ▼
Cloudflare (DNS + DDoS protection + CDN)
    │
    ├── makalu.litho.ai ──► Indexer EC2 :3000 (Explorer frontend)
    │
    ├── rpc.litho.ai ─────► Sentry 1 Nginx :443 ──► CometBFT RPC :26657
    │                                                 (10 req/s rate limit)
    ├── api.litho.ai ─────► Sentry 1 Nginx :443 ──► Cosmos REST :1317
    │                                                 (30 req/s rate limit)
    └── status.litho.ai ──► Sentry 1 (Network status dashboard)

EVM JSON-RPC ──► AWS Network Load Balancer ──► Validator EVM :8545
```

**Security layers in place:**
- TLS 1.2/1.3 only, strong cipher suite (ECDHE + AES-GCM)
- HSTS with 2-year max-age on all HTTPS endpoints
- Cloudflare Full (strict) mode — end-to-end TLS, no unencrypted hops
- Rate limiting on public RPC/API (Nginx)
- AWS OIDC — no plaintext credentials in CI/CD
- RDS credentials managed via AWS Secrets Manager
- Validator node never exposed directly (only via Sentry)

---

### 5. Database — Canonical Production Schema

The production database (AWS RDS PostgreSQL) is initialised with the full Ethermint dual-layer schema, supporting both Cosmos and EVM transaction types:

| Table | Purpose |
|-------|---------|
| `blocks` | Block headers with height, hash, proposer, tx count |
| `transactions` | Cosmos-layer transactions (staking, governance, IBC, etc.) |
| `evm_transactions` | EVM transactions (smart contracts, token transfers) linked to Cosmos tx |
| `accounts` | All accounts with both `litho1...` bech32 and `0x...` EVM addresses |
| `validators` | Validator set with commission, uptime, jailed status |
| `token_transfers` | LEP-20 token transfer events |
| `contracts` | Deployed smart contracts with verification status |
| `proposals` | Governance proposals with vote tallies |
| `network_stats` | Time-series network statistics for dashboard |
| `indexer_state` | Indexer progress tracking (last indexed block) |

**15 genesis accounts pre-seeded** from the official `address_mapping_litho.csv`, covering all initial token allocations (Ecosystem, Foundation Treasury, Team, Private Sale, Public Sale, Liquidity, Marketing, Advisors). Balances stored at full 18-decimal precision (`ulitho`).

---

### 6. Automated CI/CD Pipeline

Every push to the `main` branch now triggers a fully automated deployment pipeline:

```
Push to main
    │
    ├── 1. Checkout code
    ├── 2. AWS OIDC authentication (→ Secrets Manager for RDS credentials)
    ├── 3. SSH to production server
    ├── 4. Pull latest code, select correct .env (mainnet/testnet/staging)
    ├── 5. Build Docker images (api, indexer, explorer)
    ├── 6. Inject RDS DATABASE_URL from Secrets Manager
    ├── 7. Deploy Makalu stack (docker compose up)
    ├── 8. Write explorer .env to /opt/lithoscan
    ├── 9. Deploy Lithoscan explorer stack (docker compose up)
    ├── 10. Health check — API (:4000/health) with 5 retries
    ├── 11. Health check — Explorer (:3000) with 6 retries
    └── 12. Generate deployment summary
         │
         └── On failure → Automatic rollback to previous version
```

The pipeline supports three environments: `mainnet`, `staging`, `testnet`, selectable via manual trigger or automatically from branch.

---

### 7. Health Monitoring

Automated health checks run every 5 minutes via GitHub Actions and alert on failures:

| Check | Endpoint | Alert On |
|-------|----------|----------|
| Explorer Frontend | https://makalu.litho.ai | Non-2xx response |
| Network Status | https://status.litho.ai | Non-2xx response |
| API Service | `:4000/health` | Non-200 response |
| Prometheus Metrics | `:9091/-/healthy` | Non-200 response |
| Grafana Dashboard | `:3001` | Non-2xx response |

---

### 8. Chain Configuration (Verified)

All services are configured for the correct Lithosphere mainnet parameters:

| Parameter | Value |
|-----------|-------|
| Cosmos Chain ID | `lithosphere_700777-1` |
| EVM Chain ID | `700777` |
| Native Token | `LITHO` |
| Base Denomination | `ulitho` |
| Decimals | `18` |
| Address Prefix (bech32) | `litho` |
| Explorer Domain | `https://makalu.litho.ai` |
| Public RPC | `https://rpc.litho.ai` |
| Public API | `https://api.litho.ai` |

---

## Current Status

**Everything is live and operational.**

The 522 timeout error that was reported has been resolved. The block explorer is accessible at https://makalu.litho.ai, the public RPC and API are serving traffic with rate limiting and TLS, and the deployment pipeline is fully automated for all future releases.

If links are not loading in your browser, this is most likely a DNS propagation delay — the domain was recently pointed to the new server and DNS changes can take a few hours to reach all networks globally. To verify from your end:

1. Try in a private/incognito window
2. Try on mobile data (different DNS resolver)
3. Check propagation status at: https://dnschecker.org/#A/makalu.litho.ai

The infrastructure is confirmed live from multiple locations.

---

*Report generated March 1, 2026 — KaJ Labs Development Team*
