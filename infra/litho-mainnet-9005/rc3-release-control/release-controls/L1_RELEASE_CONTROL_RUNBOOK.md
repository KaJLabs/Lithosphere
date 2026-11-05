# LITHO L1 release-control gate

This control applies to every L1 binary activation on Makalu, Kamet, and
mainnet. It does not itself deploy, restart, or submit a transaction.

## Mandatory sequence

1. Freeze the source and publish the exact binary as an immutable GitHub
   release asset.
2. Obtain Autha's structured JSON approval for that release identity and target.
3. Obtain KaJ Labs' structured JSON approval for the exact target, validator, UTC
   window, operator, observer, rollback plan, and any consensus pause.
4. Hash both approval artifacts, populate a schema-v2 copy of
   `L1_RELEASE_APPROVAL_TEMPLATE.json` under the protected approvals path.
   Sign that complete approval bundle offline with the pinned KaJ Labs
   organizational release key and place its detached signature beside it.
5. Run `LITHO L1 release approval gate` against the tag, binary asset, approval
   JSON, and target environment.
6. Require a reviewer other than the execution operator on the corresponding
   `l1-<environment>-activation` GitHub environment.
7. Retain the successful workflow URL and gate artifact. A failed, skipped, or
   absent gate prohibits activation.
8. Immediately before mutation, run the same verifier on the target host
   against the exact staged binary and approval bundle.
9. Collect raw before/after evidence and obtain the observer attestation.

## Required environment protections

Create three independent environments:

- `l1-makalu-activation`
- `l1-kamet-activation`
- `l1-mainnet-activation`

Each environment must require approved reviewers and prevent self-review. Do
not store validator keys or approval-document contents as environment secrets.
Administrator bypass must remain disabled. The reviewed target profile in
`verify_l1_release_approval.py` is authoritative for chain identity, approved
validator identity, and the pause requirement. An unconfigured validator fails
closed until added by a reviewed source change.

## Direct verifier

```bash
python infra/litho-mainnet-9005/scripts/verify_l1_release_approval.py \
  --approval /secure/path/release-approval.json \
  --binary /secure/staging/lithod \
  --environment makalu \
  --expected-release-id litho-l1-v20.0.0-r1 \
  --release-signing-public-key /secure/reference/KaJ-Labs-Release-Signing-PublicKey.asc
```

The verifier denies activation when the bundle signature is invalid, the
binary or immutable release identity differs, a structured approval artifact
is absent, modified, or semantically mismatched, an approval postdates the
window, the window is not active, the target profile differs, the observer is
the operator, or the profile's pause requirement lacks explicit approval.

Root-level emergency bypasses must be treated as incidents and documented as
release-control exceptions. They are never normal deployment paths.
