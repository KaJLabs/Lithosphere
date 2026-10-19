# LITHO L1 security candidate, 20 October 2026

Developer release `litho-l1-security-20261020-rc2`, derived from the retained R1 and October RPC/storage fixes.
The module path `github.com/evmos/evmos/v20` retains ancestry; upstream Evmos v20
is not claimed to be supported. KaJ Labs chain engineering owns this maintained fork.

Build: pinned Go 1.26.9 linux/amd64, GCC, `netgo,ledger`, `-trimpath`,
`-buildvcs=false`. Run `bash security/build.sh`; expected executable SHA-256:
`7133bdfd7495565f66861e4663706397a2408fdbb5751e8b8e65056dd5ece201`.

Changes: supported compiler; scan-driven network, RPC, compression, downloader,
token and cryptography dependency patches; maintained OpenPGP armor in SDK and
CometBFT; secp256k1/ECIES upstream crypto guards in the exact Evmos geth fork.
Existing fixed-supply, disabled inflation, StateDB, IBC and RPC/storage fixes remain.

The zero-copy test no longer dereferences unmapped memory after closing its DB.
It checks mapping release and safe copied values. This is a test-only correction.

`security/check.sh` runs scanners, expiry/source/exposure guards and regressions.
The weekly workflow is a packaged template; activation in the canonical hosted
source repository still needs release integration. Review `fork-ledger.json` by
19 November 2026. Zero scanner findings do not clear renamed/local sources.

The offline replay helper uses only a disposable copy of public state and fixed
RPC responses, validates commit signatures and compares canonical app hashes.
It changes only the copy's WAL-origin metadata, as the existing state-sync importer
does. Its path guard intentionally limits writes to the recorded replay workspace.

This candidate has not been independently accepted or deployed. Compiler and
cryptographic validation changes require explicit consensus-compatibility and
activation review. A bounded replay is not proof of all future mixed-version cases.
Do not replace a live validator binary using this build script.
