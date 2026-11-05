# QUANTTS partner integration

The partner confirmed that `quantts.ai` replaces `quantt.at`. The approved API is `https://api.quantts.ai`, authenticated server-side with `X-Partner-Key`.

## Current contract

- Swagger: https://api.quantts.ai/docs (spec: `/docs/json`).
- Market snapshot: `GET /v1/partner/market/snapshot?symbol=BTC`.
- Confirmed response fields: `symbol`, `as_of`, `price`, `change_pct_24h`, `volume_24h`, `realized_volatility`, and `metadata.source`.
- BTC returned a valid snapshot. LITHO returned `unknown symbol: LITHO` during verification on 2026-10-13 (Asia/Karachi).
- This is market data, not an AI signal/score. Quote-currency metadata is absent; the UI does not invent a USD label.
- The supplied key is held in GitHub environment secrets named `QUANTT_API_KEY` for staging and mainnet. Never put the credential into source, client environment variables, or documentation. Partner states a 180-day lifetime; issuance date must be confirmed before assigning an expiry date.

## Server configuration

`QUANTT_API_BASE_URL=https://api.quantts.ai`, `QUANTT_API_AUTH_HEADER=X-Partner-Key`, `QUANTT_INSIGHTS_PATH=/v1/partner/market/snapshot`. Compose receives the secret via the deployment environment. HTTPS origin/path are validated, redirects are disabled, symbols are validated, successful snapshots are allowlisted and cached for 60 seconds with a 100-entry bound. Unknown symbols produce a clear 404; malformed/provider errors never expose raw provider bodies or credentials.

## Activation evidence

API and UI regression tests cover the partner fields, domain/auth settings, malformed responses, unsupported symbols, and secret-free output. Staging and production smoke tests require a configured canonical origin and a positive BTC snapshot.

Earlier RPC/CORS correspondence describes wallet connectivity and payments; it is independent of this market snapshot API. Agent and decision endpoints are available from the partner but are outside the current market-research page scope.

## Makalu activation - 2026-10-18

The market-snapshot integration is deployed and verified at `https://makalu.litho.ai/quantt`. Release source: `14f0ad5a35912a74eacc7c9e7159aab8f5618e62`, based on the prior live Makalu source `8d58dafa1837a2aeb16cad90f96c1775a562cf6d` to preserve its newer validator and explorer behavior.

- API build and 7 focused API tests passed; 3 explorer normalization tests passed.
- [API publication](https://github.com/KaJLabs/Lithosphere/actions/runs/39141325314) and [explorer publication](https://github.com/KaJLabs/Lithosphere/actions/runs/39141328299) passed the existing security, signing, and provenance gates.
- API image: `ghcr.io/kajlabs/lithosphere-api@sha256:79a84666a3f9f939a956081e4e0172164d34b1c8c568d59f3aa73a417b9d80f4`.
- Explorer image: `ghcr.io/kajlabs/lithosphere-explorer@sha256:67c96edc051cec41e17787bb5cea1d54a27936c4597e9c17c8ded57e870a1157`.
- A private loopback candidate verified the configured canonical origin, BTC snapshot, invalid-symbol rejection, and the provider's unsupported-LITHO response before promotion.
- Public `/api/version` confirms the release SHA. `/api/quantt/status` reports configured; BTC returns validated price/change/volume/source fields.
- Live Chromium and WebKit touch checks passed in dark/light modes, including canonical portal navigation, unsupported-symbol behavior, no stale result after errors, no horizontal overflow, and no direct browser calls to the provider.
- Existing blocks, transactions, validators, and tokens APIs return HTTP 200. API, explorer, and indexer containers are healthy. Faucet and indexer container identities were unchanged.

Only API and explorer were recreated in `/opt/lithoscan`. The compose file pins their immutable digests and references a root-owned mode-0600 provider env file under `/opt/lithoscan/releases/quantts-14f0ad5/`. The existing authorized server credential was transferred directly on the host; it never crossed browser code, repository files, or command output. Previous compose/env files and image identities are retained in that release directory for rollback. Existing API transaction/token patches, session secret, network settings, and the repaired RPC configuration were preserved.

Scope closed: market snapshots in the Makalu explorer. Agents, trade decisions, and provider support for LITHO are not part of this integration.
