# Validator / Infra Team — Action Items from Security Audit

**Date**: 2026-03-30
**From**: Dev Team
**Context**: We've addressed all code-level findings from the security audit in our repo. The items below require infra team action — either infrastructure changes, access we don't have, or coordination with external services.

---

## 1. Deploy Status API Fixes to Production (from your DEV_TEAM_UPDATE.md)

Your endpoint sanitization and real block time fixes are committed but not yet deployed. Per your doc:

```bash
cd ansible
export ANSIBLE_ROLES_PATH=./roles ANSIBLE_HOST_KEY_CHECKING=False
ansible-playbook -i inventory/hosts.ini playbooks/deploy-explorer-sentry.yml \
  -e "postgres_password=<PW>" -e "redis_password=<PW>"
```

This rebuilds the `network-status` container with sanitized endpoints and real metrics on Sentry-1.

---

## 2. Finding #3 (High): Weak Decentralization Signal

**What we did**: Explorer already displays validator list with voting power and commission.

**What we need from you**:
- Publish a **seed node list** (node IDs + addresses) that external validators can use to bootstrap
- Confirm the **active validator set size** and current validator count so we can display it accurately
- Provide **sentry topology guidance** — minimum recommended peers, geographic distribution recommendations
- Clarify: should we label Makalu as "testnet" explicitly in the explorer UI and status API? The audit flagged that we're presenting testnet posture as mainnet.

---

## 3. Finding #4 (High): Binary Provenance

**What we need from you**:
- Publish **reproducible build instructions**: exact repo URL, commit hash, Go compiler version, and build command for `lithod`
- Publish **signed release manifests** with SHA256 digests for all official binaries
- Document the **exact Evmos upstream fork point** and patch delta (which Evmos commit was forked, what was changed)
- Host deterministic binaries at a **single canonical release location** (GitHub Releases on KaJLabs/Lithosphere, or a dedicated downloads page)
- Generate and publish an **SBOM** (Software Bill of Materials) — this is planned for Phase 2/3 of the infrastructure roadmap

---

## 4. Finding #9 (Medium): NLB Environment Naming

The NLB is named `litho-mainnet-rpc-*` but serves Makalu testnet. Your doc says this requires downtime to rename.

**Request**: Schedule this for the next maintenance window. No rush — just don't forget it.

---

## 5. Finding #10 (Medium): Rate Limits and Anti-Spam

We've documented what we know in `docs/network/chain-parameters.md`. But we need authoritative numbers from you:

- **Minimum gas price** enforced by validators (exact value in `ulitho`)
- **Mempool configuration**: max mempool size, tx queue limits
- **Nginx/Cloudflare rate limits** on `rpc.litho.ai` and `api.litho.ai` (requests per second per IP)
- **Pruning configuration**: what's the pruning strategy on sentry nodes? What's the recommendation for indexers that need archive data?
- **WebSocket connection limits** on the EVM WS endpoint

---

## 6. gRPC TLS Proxy (from your DEV_TEAM_UPDATE.md)

Your endpoint cleanup changed the default gRPC to `grpc.litho.ai:9090`. We've used this in our `network-parameters.json`. Is TLS actually configured on this endpoint now, or is it still direct/plaintext? If plaintext, we should note that in our docs.

Same question for **EVM WebSocket** — is `wss://` available via Nginx, or still `ws://54.163.248.63:8546` direct?

---

## 7. Open GitHub Issues on KaJLabs/Lithosphere

The audit flagged issue #3 ("[TESTNET] Deployment Failure") — it's now closed. But two issues remain open:

- **#5**: "Fix grammatical error in 'What is Lithosphere?'" (opened 2026-03-24)
- **#4**: "Update deploy-indexer-ec2.sh" (opened 2026-03-23)

**Request**: Triage these — close, assign, or comment with status. Open unattended issues on a public repo hurt credibility per the audit.

---

## 8. Network Parameters JSON

We've published a machine-readable `docs/network/network-parameters.json` with canonical chain config for wallets and operators. Please review it and confirm all values are correct — especially:

- `networkType`: We set `"testnet"` — confirm this is correct for Makalu
- `apis.grpc` address: `grpc.litho.ai:9090`
- `apis.evmJsonRpc`: We pointed at `https://rpc.litho.ai` — is this the correct public EVM JSON-RPC endpoint?

---

## 9. Directory Rename: Makulu → Makalu (CRITICAL for next deploy)

We've renamed the monorepo directory from `Makulu/` to `Makalu/` to match the network name. All CI/CD pipelines, deploy scripts, and env files now reference `/opt/lithosphere/Makalu`.

**Before the next deploy**, you must rename the directory on the production server:

```bash
ssh ec2-user@<INDEXER_IP> -o ProxyJump="ec2-user@44.218.142.100"
sudo mv /opt/lithosphere/Makulu /opt/lithosphere/Makalu
```

If the deploy runs before this rename, it will create a new `/opt/lithosphere/Makalu` directory alongside the old one, and the existing containers under `Makulu` will keep running on stale code.

---

## 10. HTTPS EVM JSON-RPC proxy (NEW — reported 2026-04-22)

**Severity**: High — blocks EVM wallet UX on Makalu.

**Problem**:
`https://rpc.litho.ai` is currently routed to the Cosmos Tendermint RPC on Sentry 1. It answers `eth_chainId` correctly (`0xab169` = 700777) but returns empty `0x` for every other EVM method — `eth_getCode`, `eth_call`, `eth_getLogs`, etc. When a user adds the Makalu network to MetaMask / Trust / Rabby (using the explorer's advertised `rpcUrl: https://rpc.litho.ai`) and then pastes a LEP100 token contract address, the wallet calls `eth_getCode`, gets `0x`, and concludes "this is not a contract" — refusing to auto-fetch `name/symbol/decimals`.

All 10 LEP100 tokens are **verified deployed on-chain** (confirmed via the NLB endpoint which returns ~2.3 KB of bytecode per address and correct `symbol()` return values). The failure is purely a client-side RPC-routing issue.

**Evidence** (from 2026-04-22):
```
# rpc.litho.ai — half-broken
$ curl -sS -X POST https://rpc.litho.ai -H 'Content-Type: application/json' \
    -d '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}'
→ {"jsonrpc":"2.0","id":1,"result":"0xab169"}                    # correct

$ curl -sS -X POST https://rpc.litho.ai -H 'Content-Type: application/json' \
    -d '{"jsonrpc":"2.0","method":"eth_getCode","params":["0xEB6cfcC84F35D6b20166cD6149Fed712ED2a7Cfe","latest"],"id":1}'
→ {"jsonrpc":"2.0","id":1,"result":"0x"}                          # WRONG — should return bytecode

# NLB :8545 — works correctly
$ curl -sS -X POST http://litho-mainnet-rpc-nlb-90cbce98dabd2453.elb.us-east-1.amazonaws.com:8545 \
    -H 'Content-Type: application/json' \
    -d '{"jsonrpc":"2.0","method":"eth_getCode","params":["0xEB6cfcC84F35D6b20166cD6149Fed712ED2a7Cfe","latest"],"id":1}'
→ {"jsonrpc":"2.0","id":1,"result":"0x608060405234801561001057600080fd5b50…"}
```

**Blocker to direct fix in the explorer**: the NLB is plain HTTP. Browsers block mixed content from `https://makalu.litho.ai`, so we cannot just swap the `rpcUrl` to the raw NLB URL in `Makalu/explorer/context/WalletContext.tsx`.

**What we need from you** (preferred — pick one):

### Option A (preferred): stand up `evm-rpc.litho.ai` HTTPS proxy
Same pattern already in use for `rpc.litho.ai` and `api.litho.ai`:
- Create `evm-rpc.litho.ai` DNS A record pointing at Sentry 1
- TLS-terminate on Sentry 1 nginx (Let's Encrypt cert, same issuance flow as the others)
- Reverse-proxy all POST requests to Ethermint JSON-RPC on `:8545` of the validator/sentry (or keep the NLB as the upstream — whichever is the intended stable target)
- Enable CORS `Access-Control-Allow-Origin: *` so the explorer frontend can also make direct reads if needed
- Recommended: rate limit comparable to `rpc.litho.ai`

Once live, the dev team will update:
- `Makalu/explorer/context/WalletContext.tsx:17` → `rpcUrl: 'https://evm-rpc.litho.ai'`
- Explorer-facing chain-config / docs / "Add to MetaMask" helpers
- `Makalu/.env.mainnet` EVM_RPC_URL (optional — indexer can stay on the internal NLB)

### Option B: fix rpc.litho.ai's nginx to proxy `eth_*` correctly
Adjust the Sentry 1 nginx so the existing `rpc.litho.ai` host properly proxies EVM JSON-RPC methods (currently it forwards to CometBFT :26657 which doesn't implement `eth_getCode`/`eth_call`). Target is the Ethermint JSON-RPC port on the same node (`:8545`). This keeps the existing URL but requires method-aware routing or running a side-service that speaks both.

**Option A is cleaner** (separates concerns, no behavior change on `rpc.litho.ai`, matches industry convention of a dedicated EVM-RPC subdomain).

**Success criteria** (what we'll test before flipping the explorer):
```bash
$ curl -sS -X POST https://evm-rpc.litho.ai -H 'Content-Type: application/json' \
    -d '{"jsonrpc":"2.0","method":"eth_getCode","params":["0xEB6cfcC84F35D6b20166cD6149Fed712ED2a7Cfe","latest"],"id":1}'
# Must return a non-0x bytecode string (>100 chars)

$ curl -sS -X POST https://evm-rpc.litho.ai -H 'Content-Type: application/json' \
    -d '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}'
# Must return 0xab169
```

---

## Summary

| Item | Severity | Action |
|------|----------|--------|
| **Rename `/opt/lithosphere/Makulu` → `Makalu`** | **Critical** | **Must happen before next deploy** |
| Deploy status API fixes | Critical | Run ansible playbook on Sentry-1 |
| Seed node list + topology guidance | High | Publish for external validators |
| Binary provenance (builds, SBOM, fork docs) | High | Publish reproducible build instructions |
| **HTTPS EVM JSON-RPC proxy (`evm-rpc.litho.ai`)** | **High** | **Stand up HTTPS proxy → NLB:8545 — blocks wallet token UX** |
| NLB rename | Medium | Next maintenance window |
| Rate limit / anti-spam numbers | Medium | Provide authoritative config values |
| gRPC/WSS TLS status | Medium | Confirm endpoint TLS configuration |
| GitHub issue triage | Medium | Close or update #4 and #5 |
| Review network-parameters.json | Low | Confirm values are correct |
