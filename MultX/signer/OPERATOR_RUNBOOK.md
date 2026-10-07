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

For a separately approved native signer identity, mount the reviewed native
policy file at `/run/config/native-policy.json`, set
`SIGNER_NATIVE_POLICY_FILE` and `SIGNER_NATIVE_STATE_FILE`, and initialize the
native journal independently while both signing flags remain false:

```sh
node scripts/initialize-state.js /run/config/state-identity.json /var/lib/multx-signer/native-settlement.jsonl PUBLIC_SIGNER_ADDRESS --confirm-first-use-new-identity --native
```

Use a separate reviewed Compose override to mount the native policy read-only.
For each chain, the native policy must name an approved primary `rpcUrl` and a
separate-provider `finalityRpcUrl`. Both endpoints must support the chain's
`finalized` block tag. No confirmation-depth fallback is configured. A missing,
disagreeing or regressing finalized view blocks native signing. Keep the two
provider references private and verify their independence before acceptance.
An existing native journal must be restored from the latest approved backup;
first-use initialization is never a recovery/reset operation. Keep
`SIGNER_NATIVE_SIGNING_ENABLED=false` until native settlement acceptance and
activation approval.

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


## FC-H01 canary relay and persistent finality hold

This candidate adds an operator-driven native-vault relay. It is not wired into
legacy bridge release relaying or the public swap API. It does not authorize a
canary, unpause a vault, collect certificates, or enable either signer flag.

The signer creates `<SIGNER_NATIVE_STATE_FILE>.finality-hold` on **any** native
evidence verification failure. This deliberately conservative canary rule blocks
all native signing on that host, including refunds, and survives restart. Preserve
the hold file with the journal in backups/restores. Never delete it to retry, roll
back to a binary that ignores it, or automatically issue a source refund following
a payout/finality anomaly. Disable affected signing/relay, have the pause guardian
pause affected routes/vaults if necessary, and obtain a reviewed reconciliation
and recovery procedure. A successful later RPC response does not clear a hold.

### One approved relay attempt

Use the accepted build on the coordinator with a separately operated primary and
finality provider for each chain. Both must support genuine protocol `finalized`.
The relay independently runs the same evidence checks; it does not trust an earlier
signer's successful response. There is no confirmation-depth fallback.

Privately prepare these inputs for one exact approved action:

- Native policy JSON: the accepted quote signer, authority epoch, vaults and dual
  RPC configuration (same schema as the signer; no signing key).
- Packet JSON: `action` (`release`, `finalize`, `cancel` or `refund`), immutable
  `operation`, `destination` (`chainId`, `vault`), three ordered `signatures`, and
  `evidence` in the existing native signer request format. Cancellation/refund
  also include `request`; finalization includes `destinationTxHash`.
- An externally signed zero-value EIP-155 legacy or EIP-1559 transaction calling
  the exact vault method directly. Do not put private keys on the coordinator.
  Keep raw transactions/certificates private: they can confer broadcast authority.
- An authenticated operator-approved approval JSON and independently confirmed
  SHA-256. Required fields: `action`, `operationId`, `transactionHash`, `relayer`,
  `quoteSigner`, `authorityEpoch`, `runtimeHash` (keccak256 of reviewed vault runtime),
  `start`/`end` (integer UTC Unix seconds), `policySha256` (exact private policy bytes),
  and `journalDirectory` (absolute private path for this approved attempt). Release
  also requires `maxOutputWei` as a positive integer string. Approval hash binding
  checks integrity, not identity: retain the actual authorized approval separately.

Release is bounded by the lowest of the approved ceiling, 10% of freshly read
available destination liquidity, and 10% of its daily payout cap. The signed quote
must bind the same operation/output/recipient; its expiry and certificate expiry
must still be valid after protocol finality checks. Do not substitute historical
reserve values or shorten finality to fit a quote.

From `MultX/signer`, only inside the separately approved action window:

```sh
MULTX_NATIVE_RELAY_ENABLED=true node src/relayNativeOnce.js \
  /private/approval.json EXPECTED_APPROVAL_SHA256 \
  /private/native-policy.json /private/packet.json \
  /private/signed-transaction.txt /private/relay-journals/APPROVED_ATTEMPT
```

The last path must exactly match `approval.journalDirectory`. Its parent must
already exist and be owner-only on Linux. The attempt directory must not exist.
The command exclusively claims it **before** RPC work. Any existing directory
blocks execution, including after a crash; never remove it or choose another path
as a retry. A separate attempt/action requires reviewed evidence and authorization.

The relay verifies the chain/runtime, revalidates finalized evidence, simulates the
exact transaction against current contract rules, applies the payout ceiling,
and revalidates finality again immediately before broadcasting. It never changes
calldata, gas, signatures, operation IDs or transaction hashes. All errors after
claim record HOLD; an ambiguous send is not retried or automatically refunded.
Success means SUBMITTED only, not mined/finalized/accepted. Return sanitized
transaction/hash and journal evidence references; verify finalized receipt/state
before requesting any next action. One canary operation at a time, no background
retry or second release until post-canary review.

Raw transactions remain externally executable and certificates cannot be revoked
by this CLI. Keep custody restricted and vaults paused until the exact bounded
canary is authorized. A detected finality anomaly after payout requires quarantine,
route/signing suspension and manual reconciliation, never automatic refund.
