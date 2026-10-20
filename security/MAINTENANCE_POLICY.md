# LITHO L1 security maintenance

Accountable owner: KaJ Labs chain engineering (the team operating this repository).
Scope: mainnet `lithosphere_9005-1`, EVM `9005`, and its tested release candidates.
Adopted 20 October 2026. This policy does not certify a release or authorize a
consensus interruption.

## Release identity

LITHO is responsible for maintaining its Evmos-derived chain source. An upstream
version label is ancestry, not evidence of current support. Retain that ancestry
and assign every maintained release a distinct LITHO identifier. Publish the
source archive/commit, complete patch set, exact compiler, module graph, local
replacement sources, build flags, SBOM, executable SHA-256 and test results.
Identify validator and sentry variants explicitly. A historical build script or
an audit of another executable must not substitute for this release identity.

Use a supported Go release and a current security patch within that release.
Pin the downloaded toolchain by the official archive checksum. Record scanner
version and vulnerability database date, and scan the actual release binary.
Regenerate evidence when changing any source, dependency, compiler or build flag.

## Advisory review

Chain engineering owns review of Go, Cosmos SDK, CometBFT, IBC-Go, Evmos,
go-ethereum and the remaining dependency graph. Review advisories before each
release and at least weekly between releases; review critical upstream notices
when received. This document does not establish that an automated notification
or review service is running.

Maintain an advisory ledger with identifier, upstream affected range, actual
fork/replacement identity, enabled package or execution path, remediation,
regression evidence and unresolved release gates. Distinguish version matches,
binary symbol presence, source call paths and demonstrated exploitability.
Inspect upstream ancestry for forks that scanners do not identify. A local
`(devel)` replacement or an empty scanner result for a renamed fork is not a
vulnerability clearance.

For each applicable finding, upgrade to a compatible patched dependency,
backport the reviewed fix, remove the affected optional feature, or document
the remaining exposure. A replacement must pass compatibility checks. Do not
silence a scanner match by changing version strings or treating a false-positive
disposition as a source fix. Preserve unresolved findings in the release report.

## Validation and activation

Preserve and test the fixed supply, permanent inflation disable, StateDB
security guards, EVM/Cosmos identities, transaction signing, bank transfers,
ERC-20/IBC behavior, database recovery and accepted RPC resource fixes.
Validate compiler/dependency changes against an isolated canonical-state copy
and compare block/application hashes; never replay a candidate against a live
signer's databases. Test startup, clean restart and rollback without rolling
back the authoritative signing state.

Classify consensus-sensitive changes explicitly. Changes to EVM execution,
serialization, cryptographic validation or state migration require replay and
coordinated protocol activation as appropriate; do not infer rolling-upgrade
compatibility from successful compilation or an unchanged genesis file.

Use existing independent review and release controls for the exact candidate.
Record the successful gate and target-specific activation evidence. The user
request to fix security authorizes engineering work; it does not supply an
independent reviewer's attestation or make an unavailable quorum available.
Never manufacture those artifacts.

Before maintenance, measure all voting power affected by a service/host change,
including colocated validators. Require strictly more than two thirds of current
commit-signing power to remain available for any change represented as rolling.
Serialize changes and recheck before each one. If this cannot be met, prepare the
release and the exact remaining quorum/maintenance decision; do not cause an
unannounced halt to complete a security rollout.

## Closure statement

Report separately: source remediation, reproducible build, vulnerability triage,
independent acceptance, testnet validation and production deployment. Point 1
cannot be declared closed solely because an old patch was deployed, a new binary
was built, or a public version string changed. Exchange evidence must name the
actual running hashes and disclose any remaining exposure or support limitation.

## Upstream release tracking (Autha L1P1-01 and -03)

Before every release and weekly, check official Go release history/downloads and
the CometBFT 0.38, Cosmos SDK 0.50 and IBC-Go 8 release/tag feeds and changelogs,
even when OSV and govulncheck have no new entries. Record source URLs, newest
reviewed stable release, adopted base, exact backports and protocol deferrals in
upstream-release-ledger.json. A patch tag can contain a state-machine change;
review it rather than blindly adopting it. The gate fails on a newer unreviewed
release, expired review, feed error or inconsistent compiler. Deferral is visible
technical debt and cannot be described as upstream security clearance.

The canonical workflow runs release-feed, formatting and vet checks. This local
candidate contains the workflow; it has not been pushed or observed in hosted CI.
The delivered local execution logs establish only the checks actually run here.

Release builds require Linux amd64 CGO_ENABLED=1. The pure-Go btcec curve lacks
the range wrapper and is not an approved release variant (Autha O-1). ProtonMail
armor intentionally ignores CRC24 per its decoder: unencrypted armored public
keys have no corruption-detection guarantee. Authenticate public keys through
their fingerprint and a trusted channel; encrypted exports retain AEAD integrity
(O-2). CRC24 is not authentication.
