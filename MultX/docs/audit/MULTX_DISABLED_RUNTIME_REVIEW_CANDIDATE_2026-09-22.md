# MultX disabled-runtime closure candidate

Status: review candidate only. MultX remains disabled. This document authorizes
no deployment, signing, relaying, canary or activation.

## Review purpose

This candidate responds to Autha's 22 September O-14/O-19 review. It submits the
previously unreviewed disable gate and the strengthened staging controls for
source review before a new closure rehearsal is treated as evidence.

The comparison baseline is tag `multx-native-review-2026-09-19`, commit
`d77bd4214dbbbbcabe99df373a2d86ad572e7819`, manifest SHA-256
`50a78a8c4e177b707bcd4a3887f0400100c5d5c5aa86a4dd20f6de8e963ff472`.
The final candidate tag, merge commit, complete per-file manifest and changeset
are supplied in the external review archive generated from the merged commit.

## Runtime boundary

- Production defaults to `MULTX_ENABLED=false` and accepts only exact boolean
  strings.
- While disabled, `/bridge`, `/tokens` and `/chains` use a common 503
  `MULTX_DISABLED` handler.
- Native settlement route modules remain structurally unmounted in `index.js`.
  Their source is present in the image but no application route reaches them.
- Event listeners, validator/signing services and release relaying do not start.
- Disabled production rejects attempts to enable in-process database migrations.

## R-01 and O-19 response

The API image carries a candidate manifest and verifier outside `/app`. The
verifier runs inside the image, enumerates `/app` bidirectionally while excluding
only `node_modules`, and hard-fails on any missing, mismatched or unlisted source
file. It reports its own digest, the manifest digest and explicit counts. The
manifest is reproducibly generated from tracked API source using
`generate-runtime-source-manifest.mjs`.

## R-02 response

The migration owner and API runtime roles are separated. A one-shot migrator
applies the reviewed migrations. The running API uses `multx_staging_app`, which
has no elevated role attributes, database/schema CREATE rights or non-SELECT
table grants. The verification SQL hard-fails on privilege or testnet-data drift.

The API and database use only an internal Docker network. The API publishes no
host port. Application behavior is exercised with loopback requests from inside
the API container. The evidence captures Docker's internal-network property and
an external-connectivity refusal probe.

## R-03 response

The disposable staging database must be rebuilt from an empty volume after this
candidate is reviewed. The fresh migration ledger will record the candidate's
exact migration 016 checksum, which the closure evidence captures explicitly.

## Evidence standard

The closure verifier produces a results narrative, in-image source attestation,
in-image verifier and manifest copies and hashes, application responses, runtime
isolation, database privileges, migration-016 ledger binding, network-egress
result, sanitized logs and relative-path SHA-256 checksums.
