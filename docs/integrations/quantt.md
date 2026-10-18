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
