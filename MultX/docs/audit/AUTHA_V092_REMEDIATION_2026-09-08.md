# MultX v0.9.2 focused remediation candidate

Status: submitted for independent review; deployment and activation remain gated.
Baseline: v0.9.1 commit `1c23379723b19ed1a38a5f4a67192eac5958c86a`.

The supplied Autha v0.9.1 focused review closes package H-01/M-01/M-02/O-01
on their technical merits. Those identifiers differ from Autha's register:
package M-02 maps to Autha L-03, package O-01 extends Autha L-02, and package
O-02 maps to Autha O-01 (operational readiness). Do not describe new local
remediation evidence as independent closure of the remaining findings.

## M-03: bytecode reproduction

The v0.9.1 build used CRLF in the two edited bridge files. Git archived their
LF-normalized committed bytes. Compiler metadata commits to source bytes, so
those builds had identical executable bodies but different full runtime hashes.
We reproduced the difference by changing only each bridge's line endings in
the retained compiler input. The prior evidence is not a deployment root.

Evidence generation now compares every compiler source input with its current
file and every project source with the declared immutable Git commit, byte for
byte. It rejects CRLF drift, stale inputs, a different compiler, and artifact
creation/runtime disagreement. Dependency inputs are compared with installed
files; clean installs use the shipped lockfile. Each record retains a compiler
input digest for diagnostics. Git is required for evidence generation.

The archive reproduction command works without Git after extraction and clean
installation/compilation. It compares creation bytes and full runtime hashes,
including metadata, for GovTimelock, both bridges and WrappedLEP100. It also
checks compiler settings and immutable references. Full runtime verification
is unchanged; metadata is not stripped to make mismatched artifacts pass.

CI now repeats the build from a fresh Git archive and rejects any discrepancy.
The handoff records archive-level reproduction evidence against the final
candidate identity. A separate Autha reproduction and acceptance remains due.

## L-01 and L-02: missing negative coverage

Added isolated negative assertions for approved-plan digest, each independent
evidence digest, precomputed bridge address and receipt contract address; API
RPC identity, quorum/count/list length and signer identity; undeclared live
roles, granted/revoked history versus live roles, minimum delay, removed logs;
enabled/removed token history versus live support; journal on-load equivocation,
explicit symlink refusal, and the required production identity file.

`node MultX/scripts/check-closure-mutations.cjs contracts|api|signer` removes
each selected guard independently, verifies a negative assertion fails, and
restores exact source bytes in finally blocks. It requires a passing baseline
and refuses Windows signer execution because skipped permission tests cannot
prove Linux behavior. CI runs all three groups sequentially within their jobs.
Run it only in an isolated checkout, never alongside tests or builds.

The gate covers 20 targeted mutations (12 contracts, 5 API, 3 signer). It is
regression evidence for the listed controls, not exhaustive mutation coverage.

## O-04: event documentation

Both bridges now give SupportedTokenSet and SupportedRouteSet their own
accurate NatSpec comments. This changes metadata again, so v0.9.1 evidence
must not be reused. No bridge execution logic or authority policy changed.

## Remaining external gates

Autha must accept the new source/evidence correspondence and review closure
of M-03/L-01/L-02. Autha O-01 remains open: independent signer hosts/custody,
current recovery evidence and separate identities, approved Safe code and
authority, routes/caps/finality/RPC policy, staging/restore, monitoring, fresh
paused four-chain deployments, read-only verification, canary and activation
approval. BrewCodeDev's operator PR #24 must adopt the accepted replacement
identity and mounts before it can certify production readiness.

This work does not authorize production deployment, funding, signing enablement,
unpausing or public integration.
