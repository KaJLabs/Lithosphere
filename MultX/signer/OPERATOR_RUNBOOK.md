# MultX signer operator runbook

This runbook prepares one independent signer. It does not enable MultX or alter
any on-chain validator set.

## Operator inputs

Each operator independently supplies:

- one dedicated VPS with encrypted storage and current security updates;
- one secp256k1 validator key generated on that operator's trusted system;
- one TLS server certificate/key and the CA certificate that issued the
  coordinator's client certificate;
- one reviewed policy containing only approved source bridges and token routes;
- one encrypted offline backup of the validator key and signing journal.

Only the checksummed validator address, signer URL, TLS certificate metadata and
policy checksum are shared with the coordinator. Never send private keys through
chat, email, source control or CI variables.

## Host preparation

1. Create an unprivileged deployment account and install Docker Engine with the
   Compose plugin.
2. Create operator-controlled directories for secrets, configuration and state.
   The container runs as UID/GID 1000, so grant only that identity read access
   to mounted secrets and read/write access to the state directory. The private
   key and journal must be mode `0600`; their directories must be `0700`.
3. Copy `compose.example.yaml` as `compose.yaml` and `signer.env.example` as
   `signer.env`. Put `SIGNER_PRIVATE_KEY_PATH`, `SIGNER_POLICY_PATH`,
   `SIGNER_TLS_CERT_PATH`, `SIGNER_TLS_KEY_PATH`, `SIGNER_CLIENT_CA_PATH`, and
   `SIGNER_STATE_PATH` in Compose's separate root-readable `.env` file; do not
   commit it.
4. Replace the image placeholder with the independently verified immutable image
   digest from the approved release.
5. Restrict inbound TCP/9443 at the VPS firewall to the coordinator's fixed
   source addresses. SSH must use keys and a separate management allowlist.
6. Start with `docker compose up -d`, confirm container health, then inspect only
   non-sensitive identity and rejection logs.

## Acceptance checks

- `/v1/identity` succeeds only with the approved mTLS client certificate and
  reports the expected validator address.
- An unauthenticated TLS client is rejected.
- A wrong source chain, bridge, token route, event, or insufficient-confirmation
  request is rejected without writing a signing decision.
- A policy RPC pointed at the wrong chain ID is rejected.
- Missing/malformed confirmation depth, an insecure remote RPC, duplicate
  source/route, zero critical address, or corrupt journal prevents startup.
- Any legacy AWS/KMS/DynamoDB environment variable, bearer-only production
  transport, environment-supplied policy, symlinked key/journal, or permissive
  key/journal mode prevents startup.
- Repeating the same approved request returns the same signer identity and a
  valid signature; attempting equivocation for a signed source nonce is rejected.
- Restarting the container preserves the journal and the equivocation decision.
- Restore the encrypted backup onto a clean VPS and repeat the checks.
- Configure duplicate signer identities and verify the coordinator refuses to
  start; stale/unconfigured database signatures must not satisfy quorum.
- Verify both bridge implementations reject duplicate validator identities at
  deployment and during rotation.
- Confirm a slow signing cycle cannot overlap the next coordinator poll and
  incomplete multichain evidence is rejected rather than defaulted.

## Incident response

If compromise or policy drift is suspected, block TCP/9443, stop the signer,
preserve the journal and logs, and notify bridge governance to pause and rotate
the validator set. Do not delete the key or journal until evidence and recovery
requirements are agreed. MultX must remain disabled until the audit and all
operator acceptance records are complete.
# v0.9.1 journal identity requirement

Production startup now requires both an existing initialized journal and an
owner-only `SIGNER_STATE_IDENTITY_FILE` mounted read-only at
`/run/config/state-identity.json`. Retain the approved identity independently of
the state disk. Example metadata (replace values through the custody ceremony):

```json
{
  "schemaVersion": 1,
  "signerAddress": "APPROVED_PUBLIC_SIGNER_ADDRESS",
  "deploymentPlanSha256": "APPROVED_PLAN_SHA256",
  "activationEpoch": 1,
  "generation": "APPROVED_32_HEX_GENERATION"
}
```

For a **new, never-activated identity only**, prepare the owner-only state
directory (0700) and approved identity file (0600), then run as the signer UID:

```sh
node scripts/initialize-state.js /run/config/state-identity.json /var/lib/multx-signer/signed-releases.jsonl PUBLIC_SIGNER_ADDRESS --confirm-first-use-new-identity
```

This creates an exclusive journal header and fsyncs the file and its parent. No
private key is read and no signature is produced. Keep release signing disabled.
Missing identity or journal, changed identity, empty/old-format state and partial
records stop startup before even the fixed local challenge is signed.

For an existing identity, restore the latest journal and its independently retained
identity. Never call first-use initialization after disk loss, truncate/reset the
journal, or run two instances sharing the key. A valid stale backup cannot be
distinguished using local metadata alone: independent backup freshness evidence
and reconciliation against recent decisions are still required. Existing journals
need a separately reviewed offline migration, not automatic header insertion.
