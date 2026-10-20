# LITHO L1 rc3 — Autha L1P1-R1 remediation

Maintained fork release `litho-l1-security-20261021-rc3`, not independently accepted or deployed.
Evmos v20 remains the source ancestry; KaJ Labs chain engineering owns this fork.

Relative to reviewed rc2: full CometBFT v0.38.24 with retained ProtonMail armor;
two SDK v0.50.15 nil-pointer backports; historical snapshots force ZeroCopy=false;
Go 1.26.10; five unchanged Autha test files; release-feed, format and vet gates.
IBC 8.8 ICA acceptance changes and CometBFT 0.38.26 ML-DSA protocol features are
explicitly deferred in security/upstream-release-ledger.json. They are not cleared
by an empty vulnerability scan. The no-cgo build is not an approved release.

Build with the pinned Go 1.26.10 linux/amd64 toolchain and GCC using
`bash security/build.sh`. Candidate executable SHA-256: `c80f89bf0c95360852fe3a8b6b27f6782004e2acd04b629aff236fa0d0e37a1a`.
The evidence package contains exact compiler/linker/libc identity and raw checks.
`security/check.sh` includes advisory, upstream-release, format, vet and regression
gates. Hosted CI is packaged but has not been activated or observed running.

Supply, inflation, StateDB, IBC and October RPC/storage fixes are retained.
Do not point these tools at production node homes. Independent focused review,
the broader replay condition, exact target acceptance, signed release controls
and an immediately fresh quorum preflight remain activation requirements.
