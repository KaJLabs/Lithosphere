# MultX infrastructure status

`docker-compose.testnet.yml` and `ansible/deploy-bridge.yml` are historical
Makalu/Kamet deployment references. They are retained for auditability and do
not authorize a LITHO mainnet deployment.

The Compose file binds its public-facing services to loopback, requires an
explicit database password, and disables mock validators by default. Production
secrets must be supplied through the deployment secret manager.

`network.mainnet.template.json` defines the required public deployment fields
without inventing contract addresses. Production API startup requires a
completed copy mounted at an absolute `MULTX_NETWORK_CONFIG_FILE` path. The
loader rejects historical test-chain IDs, missing Ethereum/BNB/Base mainnets,
zero or malformed bridge/token addresses, insecure RPC URLs, bridge mismatches,
and duplicate token routes.

The completed manifest is added only after the audit and mainnet
contract/governance approvals are complete. The template itself cannot pass
the loader and does not authorize deployment.

`docker-compose.mainnet.template.yml` is likewise deliberately non-runnable.
It describes the isolated PostgreSQL/API coordinator, five independent mTLS
signer connections, loopback-only API binding, read-only container filesystem,
and mounted-file custody boundary. Every `REPLACE_WITH` value must be resolved
from the approved release and secret manager before a canary review.

Production fails closed unless `MULTX_ENABLED=true` is explicitly set. The
mainnet template keeps it `false`; changing it requires separate activation
approval.

`docker-compose.disabled-staging.yml` runs the real API entrypoint against an
isolated PostgreSQL database with `MULTX_ENABLED=false`, no egress network,
and a loopback-only port. Set `MULTX_DISABLED_DB_PASSWORD_FILE` to a local
password file and start it with:

```sh
docker compose -f MultX/infra/docker-compose.disabled-staging.yml up -d --build
```

Run `bash MultX/infra/verify-disabled-staging.sh` from the exact reviewed checkout.
It verifies the disabled API responses, confirms the runtime log, and compares
every tracked API source file directly with `/app`. Store its evidence output
privately and return only the opaque reference for independent review.
