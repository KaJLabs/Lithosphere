# MultX independent signer

The production signer runs on an independently operated VPS. Each signer uses
one owner-restricted mounted secp256k1 key, a persistent fsync-backed
anti-equivocation journal, and direct TLS 1.3 mutual authentication with the
MultX API. AWS SDKs, cloud credentials, bearer-only production transport and
plaintext key environment variables are not supported.

Deployment templates and operator acceptance steps are in
[`compose.example.yaml`](./compose.example.yaml) and
[`OPERATOR_RUNBOOK.md`](./OPERATOR_RUNBOOK.md).

The signer does not blindly sign an API-provided digest. For every request it:

1. validates the configured source chain, bridge, token route and destination;
2. rejects duplicate routes, zero addresses, missing confirmation depth, and
   non-HTTPS source RPCs (except loopback rehearsal);
3. queries its own source-chain RPC, verifies its reported chain ID, and requires
   the explicit confirmation depth;
4. verifies the exact `TokensLocked` event at the supplied block;
5. recomputes the release hash locally;
6. records an fsync-backed `(sourceChain, sourceBridge, sourceNonce) -> hash` decision before
   signing and rejects equivocation, including after restart; and
7. returns an EIP-191 signature only after those checks pass.

## Production configuration

- `SIGNER_PRIVATE_KEY_FILE`: validator ECDSA private key, readable only by the
  rootless container user.
- `SIGNER_TLS_CERT_FILE` and `SIGNER_TLS_KEY_FILE`: signer server certificate.
- `SIGNER_CLIENT_CA_FILE`: CA that issued the MultX API client certificate.
- `SIGNER_POLICY_FILE`: reviewed source-chain and token-route allowlist.
- `SIGNER_STATE_FILE`: persistent decision journal; defaults to
  `/var/lib/multx-signer/signed-releases.jsonl`.
- `SIGNER_JOURNAL_BACKEND=file`; any other value is rejected.
- `SIGNER_TRANSPORT=mtls`; production rejects proxy/bearer transport.
- `SIGNER_RELEASE_SIGNING_ENABLED=false` until every activation gate passes.

The key, policy, TLS key and journal paths must be regular, non-symlink files
or directories owned by the signer UID with no group/other access. Production
policy is accepted only from `SIGNER_POLICY_FILE`, never JSON in an environment
variable.

The VPS host should use full-disk encryption, SSH-key-only administration, a
default-deny firewall allowing port 9443 only from the MultX API VPS, offline
encrypted key backup, log shipping and uptime alerts. Validator operators must
not share VPS accounts, private keys or TLS server keys.

Each policy source must set an explicit positive `confirmations` value and a
credential-free HTTPS `rpcUrl`. Every source chain and route must be unique.
The signer fails startup on malformed policy or journal data.

No production policy or key material is included. Bridge contracts and routes
must be populated only after audit approval and mainnet deployment.

## Native settlement candidate

The service also has separately gated native release, cancellation,
finalization and refund handlers. They require an approved quote-authority
signature, canonical source/destination evidence and an append-only native
decision journal. `SIGNER_NATIVE_SIGNING_ENABLED` defaults to false and is
independent of the legacy release flag. See the native policy and first-use
journal instructions in `OPERATOR_RUNBOOK.md`; native activation needs its own
review. Each native chain policy now requires `rpcUrl` and an independent
`finalityRpcUrl`. Both RPCs must expose a genuine `finalized` block tag; the
signer refuses native signatures if they disagree or finality is unavailable.
Native activation still requires separate review and approval.
