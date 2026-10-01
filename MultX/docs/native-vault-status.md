# Native vault status candidate

This is a read-only view of the R4 `NativeLiquidityVault` lifecycle. It is separate from the older wrapped-bridge quote and execution flow. It does not create quotes, submit deposits, sign releases, relay payouts, or activate routes. The normal API startup does not mount it.

To run it in an isolated review environment, set `MULTX_NATIVE_VAULT_STATUS_ENABLED=true` and provide:

- `MULTX_NATIVE_VAULT_STATUS_ROUTES`: JSON array of approved `{sourceChainId,destinationChainId,sourceVault,destinationVault,sourceConfirmations,destinationConfirmations,sourceRuntimeSha256,destinationRuntimeSha256}`. The digests are SHA-256 of deployed runtime bytecode, without the `0x` prefix.
- `MULTX_NATIVE_VAULT_STATUS_RPC_URLS`: private JSON object mapping chain IDs to RPC URLs. Store it in the secret manager, never in browser configuration or evidence packages.
- `MULTX_NATIVE_VAULT_STATUS_ORIGINS`: JSON array of exact browser origins.
- Optional `MULTX_NATIVE_VAULT_STATUS_PORT` (default 8188). The service binds to loopback by default; put an approved reverse proxy in front of it.

Start with `node src/nativeVaultStatusEntrypoint.mjs` from `MultX/api`. The reader verifies both RPC chain identities, both pinned vault runtime hashes and reciprocal route mappings at the configured confirmation anchors. It rechecks anchor hashes before returning a status. Missing or inconsistent state fails closed.

For the browser, set `VITE_MULTX_NATIVE_VAULT_STATUS_ENABLED=true`, `VITE_MULTX_NATIVE_VAULT_STATUS_API_URL` to the approved status API origin, and `VITE_MULTX_NATIVE_VAULT_STATUS_ROUTES` to a JSON array of the same chain IDs and vault addresses. The browser configuration is public; it must contain no RPC URLs or credentials. With the flag unset, the view is hidden.

The status view is only an observation aid. A displayed payout, cancellation, or refund is not an authorization to sign or relay. Production use still requires the independent review, route and deployment evidence, custody and governance acceptance, canary, and separate activation approval.
