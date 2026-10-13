# Disabled LithoVM gateway candidate

This is an isolated, review-only overlay on the pinned `litho-l1-v20.0.0-r1`
source. It does **not** modify that release's immutable manifest, build script,
or artifacts. It is not a deployable release. No Makalu or mainnet activation,
LAX deployment, or MultX change is included.

The cross-repository [security-review handoff](https://github.com/KaJLabs/Lithic/blob/f7c259ae0a8e5d9e5fb6e7b0b7cbac1428fac8ce/docs/SECURITY_REVIEW_HANDOFF_2026_09_27.md)
lists scope, trust assumptions, evidence and remaining approval gates.

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
   Build the native FFI library with `cargo +1.96.0 build --locked -p
   lithovm-ffi`. From the disposable Evmos checkout, add
   `go mod edit -require=lithic.local/native-chain-lab@v0.0.0` and
   `go mod edit -replace=lithic.local/native-chain-lab=/absolute/path/to/Lithic/integration/native-chain`.
4. Run `go test -mod=mod -count=1 ./x/evm/keeper` and
   `go test -mod=mod -tags lithovm_chain_lab -count=1 ./x/evm/keeper`.
   The tagged test still needs the native-chain Go module, but does not depend
   on the compiler executable at test runtime.

The overlay was checked against the pinned Evmos source after all five Evmos
release patches. The chain lab at the pinned commit passed ordinary and tagged
keeper suites, plus the tagged candidate race test. These are local tests,
**not** Makalu validation or an independent security review.

## R2 disabled remediation delta

The R1 overlay and immutable release patches above remain unchanged. The
`remediation-r2/` directory contains four ordered `git format-patch` files
from Evmos `0e2522d` to `ddfe53f`, covering keeper estimation, the isolated
native store and upgrade rehearsal, and the pinned-SDK CLI build fix. Verify
each SHA-256 in `manifest.txt`, then apply the four files in filename order
with `git apply --check` and `git apply` after the R1 overlay and lab-only Go
module replacements. The local verification applied all four to `0e2522d`
and compared the complete staged tree to `ddfe53f` with zero diff. The full
source snapshot is
`LITHIC_LTH_R1_REMEDIATION_SOURCE_7d8bcc7_2026-10-01.zip`, pinned by SHA-256
in the manifest; it excludes the upstream tracked Evmos `scripts/.env`.

The R2 source pins are Lithic `7d8bcc7`, Evmos `ddfe53f`, and SDK `f2e6295`.
The included [Lithic remediation tracker](https://github.com/KaJLabs/Lithic/blob/7d8bcc70be23f83f6c7b17b0e577f9c8e0f9a109/docs/LTH_R1_REMEDIATION.md)
records local evidence and open independent retests. Ordinary and tagged
command/app/keeper suites passed on the isolated VPS; the tagged chain binary
was built but not started. Lithic PR #13's cross-platform checks and all five
fuzz smoke jobs passed at `7d8bcc7`. Growth pricing and the 10M cap, full-block
validator evidence, coordinated store-upgrade rollback, Makalu acceptance and
independent security closure remain open. Do not register, deploy or activate
the tagged gateway.

## R3 focused response source

Autha's formal LTH-R2 report keeps the candidate disabled. The R3 response
uses the **current** pins at the end of `manifest.txt`, while the R1/R2 pins
above remain historical. Apply `remediation-r3/0001` after the four R2
patches. The source ZIP in the manifest includes the pinned Cosmos SDK
compatibility patch; apply that patch to the pristine SDK base before any Go
build or test. It also archives raw Git blob bytes with autocrlf conversion
disabled. WSL2 Go 1.22.12 command, app and full EVM keeper suites passed
in ordinary and tagged modes from a fresh R3 ZIP extraction with the pinned
SDK patch. Independent reproduction and the isolated full-block benchmark
are still open. The R3 ZIP is a focused retest input, not a release.

## Release blockers

- Publish and independently review the pinned toolchain and this overlay;
  remove the local Go replacement from release builds.
- Approve the chain route and consensus semantics, perform an independent
  security review, and validate signed deploy/call/failure/recovery transactions
  on Makalu with operator evidence.
- Produce a separate reproducible signed candidate release and deployment plan.
  The production manifest must remain unchanged until that review is complete.
