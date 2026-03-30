# Phase 5 Implementation Prompt — Developer Local Environment + Faucet

## Context

- **Project:** Lithosphere L1 blockchain developer infrastructure
- **Scope doc:** "L1 Developer Infrastructure Engineer Work Scope.pdf" — Phase 5: Developer Local Environment (Day 10–14)
- **Client request overlap:** Client specifically asked for a **Faucet** on production testnet (makalu.litho.ai)
- **Codebase location:** `Makalu/` directory

## What Already Exists (Phase 5 partial progress)

| Component | Status | Location |
|---|---|---|
| Docker Compose dev stack | Done | `Makalu/docker-compose.dev.yml` — 6 services: lithovm (Anvil), postgres, redis, indexer, api, explorer |
| Makefile task suite | Done | `Makalu/Makefile` — `make up`, `make down`, `make clean`, `make logs`, `make seed`, `make status`, `make restart` |
| Seed script | Done | `Makalu/scripts/seed-local.ts` — funds dev wallets + deploys demo LEP100 contract |
| `.env.local` profile | Done | `Makalu/.env.local` |
| VS Code devcontainer | Done | `Makalu/.devcontainer/devcontainer.json` |
| Faucet service | **Missing** | No faucet exists anywhere in the codebase |
| `.env` staging profile | **Missing** | Only `.env.local` and `.env.mainnet` exist, no `.env.staging` |
| Onboarding doc | **Missing** | No dedicated "new developer onboarding" doc |
| Hot-reload for contracts | **Missing/Needs verification** | Explorer has Next.js hot-reload, but contract dev workflow not verified |

## What Needs to Be Built

### 1. Faucet Service (Priority — client explicitly requested)

Build a lightweight faucet service for the Lithosphere testnet (Makalu).

**Requirements:**
- **Backend:** Fastify or Express service that sends testnet LITHO tokens to a requested address
- **Frontend:** Simple UI page at `/faucet` (or standalone `faucet.litho.ai`) where users paste a wallet address and request test tokens
- **Rate limiting:** Limit requests per address (e.g., 1 request per 24 hours per address, configurable)
- **Amount:** Configurable drip amount (e.g., 1 LITHO per request)
- **Funding wallet:** Uses a pre-funded faucet wallet (private key stored as env var, never exposed)
- **Chain connection:** Connects to Lithosphere Makalu testnet RPC at `https://makalu-rpc.litho.ai` (production) or `http://lithovm:8545` (local dev)
- **Tech stack:** TypeScript, viem/ethers.js for chain interaction, Redis for rate-limit tracking
- **Health check:** `GET /health` endpoint
- **CAPTCHA (optional):** hCaptcha or simple proof-of-work to prevent abuse

**Files to create:**
```
Makalu/faucet/
├── Dockerfile
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts          # Fastify server entry
│   ├── routes/
│   │   ├── drip.ts       # POST /drip { address: "0x..." } → sends tokens
│   │   └── health.ts     # GET /health
│   ├── services/
│   │   ├── wallet.ts     # Faucet wallet management (viem)
│   │   └── rateLimit.ts  # Redis-backed rate limiting
│   └── config.ts         # Env var config
└── frontend/             # Simple HTML/CSS/JS faucet page (or integrate into explorer)
    └── index.html
```

**Add to `docker-compose.dev.yml`:**
```yaml
faucet:
  container_name: litho-dev-faucet
  build:
    context: ./faucet
    dockerfile: Dockerfile
  ports:
    - "${FAUCET_PORT:-8081}:8081"
  environment:
    FAUCET_RPC_URL: http://lithovm:8545
    FAUCET_PRIVATE_KEY: ${FAUCET_PRIVATE_KEY}  # Pre-funded Anvil account
    FAUCET_DRIP_AMOUNT: ${FAUCET_DRIP_AMOUNT:-1}
    FAUCET_COOLDOWN_HOURS: ${FAUCET_COOLDOWN_HOURS:-24}
    REDIS_URL: redis://redis:6379
  depends_on:
    lithovm: { condition: service_healthy }
    redis: { condition: service_healthy }
```

**Add to production `docker-compose.yaml`** for makalu.litho.ai deployment with production RPC URL.

**Add to deploy pipeline** (`.github/workflows/deploy-simple.yaml`) — deploy faucet container alongside explorer.

**Update Makefile** — add `make faucet-fund` target to top up the faucet wallet from Anvil genesis accounts.

### 2. `.env.staging` Profile

Create `Makalu/.env.staging` with staging-specific values:
- Staging RPC URL
- Staging chain ID
- Staging DB credentials (different from local/mainnet)
- Staging faucet config

### 3. Onboarding Documentation

Create `Makalu/docs/ONBOARDING.md`:
- Prerequisites (Docker >= 24.0, Node >= 18, pnpm)
- Clone → `make up` → verify all services are running
- `make seed` to fund wallets and deploy demo contract
- How to connect MetaMask to local devnet
- How to use the faucet (local and testnet)
- How to develop contracts with hot-reload
- Troubleshooting common issues
- **Acceptance criterion from scope:** "New laptop to running tests locally ≤ 15 minutes, zero manual steps"

### 4. Hot-Reload Contract Development Workflow

Verify and document the contract development workflow:
- Ensure Forge/Foundry watch mode works with the local Anvil instance
- Add a `make watch-contracts` target or similar for auto-recompile + redeploy
- Ensure the explorer and API pick up new blocks/txs from redeployed contracts

### 5. Update Makefile

Add new targets:
```makefile
faucet-fund:   # Top up faucet wallet
dev:           # Start stack + seed + open explorer in browser
test:          # Run all service tests locally
watch:         # Start stack with hot-reload for contracts
```

## Environment Variables to Add

```env
# Faucet
FAUCET_PORT=8081
FAUCET_PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80  # Anvil account #0
FAUCET_DRIP_AMOUNT=1
FAUCET_COOLDOWN_HOURS=24
FAUCET_CHAIN_ID=700777
```

## Production Deployment (Makalu Testnet)

For the client's request to have a faucet at makalu.litho.ai:
- Deploy faucet service as a Docker container on the Makalu server
- Configure nginx to route `/faucet` or `faucet.litho.ai` to the faucet service
- Use a dedicated faucet wallet funded with testnet LITHO
- Set production rate limits (stricter than local dev)
- Add monitoring/alerting for faucet wallet balance running low

## Acceptance Criteria (from Scope Doc)

> "New laptop → running tests locally ≤ 15 min, zero manual steps"

- `git clone` + `make up` spins up the entire stack (chain, indexer, API, explorer, faucet)
- `make seed` funds wallets and deploys demo contracts
- All services healthy within 2 minutes
- Faucet dispenses test tokens on local devnet
- Production faucet deployed and accessible on Makalu testnet
- Onboarding doc covers the full workflow
