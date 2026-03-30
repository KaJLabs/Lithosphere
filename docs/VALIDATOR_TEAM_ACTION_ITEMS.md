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

## Summary

| Item | Severity | Action |
|------|----------|--------|
| **Rename `/opt/lithosphere/Makulu` → `Makalu`** | **Critical** | **Must happen before next deploy** |
| Deploy status API fixes | Critical | Run ansible playbook on Sentry-1 |
| Seed node list + topology guidance | High | Publish for external validators |
| Binary provenance (builds, SBOM, fork docs) | High | Publish reproducible build instructions |
| NLB rename | Medium | Next maintenance window |
| Rate limit / anti-spam numbers | Medium | Provide authoritative config values |
| gRPC/WSS TLS status | Medium | Confirm endpoint TLS configuration |
| GitHub issue triage | Medium | Close or update #4 and #5 |
| Review network-parameters.json | Low | Confirm values are correct |
