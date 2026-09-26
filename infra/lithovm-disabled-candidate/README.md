# Disabled LithoVM gateway candidate

This is an isolated, review-only overlay on the pinned `litho-l1-v20.0.0-r1`
source. It does **not** modify that release's immutable manifest, build script,
or artifacts. It is not a deployable release. No Makalu or mainnet activation,
LAX deployment, or MultX change is included.

The overlay contains only the keeper call hook, the disabled ordinary-build
implementation, the tagged lab implementation and tests, and a correction to
an existing keeper test fixture that attempted deployment from a module
account. The already-released StateDB module-account guard is *not* duplicated.
`lithovm_chain_lab` compiles an active lab gateway; that tag must never be used
for a network binary without separate consensus/security/deployment approval.

## Reproduce the source check

1. Check out Evmos at the base commit in `manifest.txt` in a disposable
   directory. Apply the six SHA-verified release patches in the existing
   release manifest/build script order. The Cosmos SDK compatibility patch
   applies to the pinned SDK checkout; the other five apply to Evmos.
2. Verify the overlay SHA-256 against `manifest.txt`, then run
   `git apply --check evmos-keeper-overlay.patch` and
   `git apply evmos-keeper-overlay.patch` from the Evmos checkout.
3. For lab tests only, use the pinned Lithic toolchain checkout and add the
   local Go module replacement for `lithic.local/native-chain-lab` at
   `integration/native-chain`. Use the dependency pins from the existing
   release build process. Do not carry a local filesystem replacement into
   a release manifest. The tagged signed-message test embeds pinned Counter
   bytecode and no longer invokes a sibling compiler executable.
4. Run `go test -mod=mod -count=1 ./x/evm/keeper` and
   `go test -mod=mod -tags lithovm_chain_lab -count=1 ./x/evm/keeper`.
   The tagged test still needs the native-chain Go module, but does not depend
   on the compiler executable at test runtime.

The overlay was checked against the pinned Evmos source after all five Evmos
release patches. The chain lab at the pinned commit passed ordinary and tagged
keeper suites, plus the tagged candidate race test. These are local tests,
**not** Makalu validation or an independent security review.

## Release blockers

- Publish and independently review the pinned toolchain and this overlay;
  remove the local Go replacement from release builds.
- Approve the chain route and consensus semantics, perform an independent
  security review, and validate signed deploy/call/failure/recovery transactions
  on Makalu with operator evidence.
- Produce a separate reproducible signed candidate release and deployment plan.
  The production manifest must remain unchanged until that review is complete.
