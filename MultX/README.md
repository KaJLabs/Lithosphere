# MultX

This directory is the audit-visible source package for the Lithosphere MultX
cross-chain bridge.

Current product direction and next work:
[native swap delivery plan](docs/NATIVE_SWAP_DELIVERY_PLAN.md). Native asset swaps,
prioritizing ETH/BNB to LITHO and back, require routing and native execution work
beyond this bridge. The one-origin wrapper launch proposal is superseded.

## Components

- `contracts/`: bridge, wrapped-token and governance contracts; tests;
  deployment scripts; and testnet deployment manifests.
- `api/`: bridge API, database migrations, event listener, relayer and
  validator-signature services.
- `signer/`: isolated non-AWS VPS signer using a dedicated mounted key,
  fsync-backed anti-equivocation journal and direct mTLS endpoint for each of
  five signers under the current 3-of-5 candidate policy.
- `sdk/`: `@litho/multx-sdk` v0.3.0 source, React adapter, presets and tests.
- `web/`: the complete Vite/React application containing the MultX bridge UI.
- `infra/`: testnet-only Compose and legacy Ansible deployment references.
- `docs/`: integration, API, operations, threat-model and audit materials.

## Release state

This is a **production candidate**, not an audited LITHO-mainnet release.
Bridge, Swap and MultX remain disabled on LITHO mainnet 9005. Existing
deployment manifests and network presets are Makalu/Kamet and external-chain
testnet records unless a file explicitly says otherwise.

Do not deploy these contracts to LITHO mainnet or enable the feature flags
until all of the following are recorded in this repository:

1. an independent security audit and remediation review;
2. approved mainnet deployment parameters and governance ownership;
3. immutable mainnet contract-address manifests;
4. validator/relayer key-custody approval;
5. end-to-end staging and production-canary evidence.

No private keys, credentials, signing material or live `.env` files belong in
Git. Use protected GitHub environments or the approved deployment secret
manager.

The v0.8.2 focused-closure candidate and evidence bundle are published, but
Autha acceptance and review of the non-AWS signer change remain required.
Older candidates and evidence files are historical inputs only and must not be
used as the current release identity.
See [`docs/MAINNET_DEPLOYMENT_GATES.md`](docs/MAINNET_DEPLOYMENT_GATES.md) for
the fail-closed production sequence and remaining approvals.
Use [`docs/V05_TESTNET_REDEPLOYMENT.md`](docs/V05_TESTNET_REDEPLOYMENT.md) for
the manifest-driven, paused Kamet/Makalu candidate redeployment procedure.
The approved signer direction and its fail-closed activation boundary are
recorded in [`docs/VPS_SIGNER_ARCHITECTURE.md`](docs/VPS_SIGNER_ARCHITECTURE.md).
Rejected AWS proposals are isolated under `docs/archive/rejected-aws/` for
historical audit traceability only.
The deployed verification infrastructure does not authorize bridge releases:
`SIGNER_RELEASE_SIGNING_ENABLED` remains false until the audit, governance,
route-policy and production-activation gates are approved.

## Reproducible checks

```bash
cd MultX/contracts && npm ci && npm test && npm run compile
cd ../sdk && npm ci && npm test && npm run typecheck && npm run build
cd ../api && npm ci && npm test
cd ../signer && npm ci && npm test
cd ../web && npm ci && npm run lint && npm run test:unit && npm run build
```

See `SOURCE_PROVENANCE.md` for the import source and integrity boundary.
