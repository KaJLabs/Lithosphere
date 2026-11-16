#!/usr/bin/env bash
set -euo pipefail
W=/home/bachal/litho-mainnet-lithovm-20261116
D=/mnt/d/Playground/litho-validator-infra/local-workspace/repositories/litho-mainnet-lithovm-20261116/dist-build-evidence
mkdir -p "$D"
cp "$W/dist-lithovm/build-metadata.txt" "$D/"
for f in lithod-build lithod-test lithod-suite; do grep -v '^go: downloading' "/home/bachal/$f.log" > "$D/$f.log"; done
(cd "$W" && sha256sum dist-lithovm/litho-l1-security-20261021-rc3-lithovm1 dist-lithovm/lib/liblithovm_ffi.so dist-lax/lithc) > "$D/BINARY_SHA256SUMS.txt"
ls -la "$D"
