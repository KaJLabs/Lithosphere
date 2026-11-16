#!/usr/bin/env bash
# Build liblithovm_ffi (release) from the pinned lithic-toolchain f7c259ae inside the WSL checkout.
set -euo pipefail
export PATH="$HOME/.cargo/bin:$PATH"
W=/home/bachal/litho-mainnet-lithovm-20261116
if [ ! -d "$W" ] && [ -d /home/bachal/port/.git ]; then mv /home/bachal/port "$W"; fi
cd "$W"
git log --oneline -1
file node/app/app.go
cd lithic-toolchain
grep -m1 -n '^name' packages/vm/lithovm-ffi/Cargo.toml
rustc --version
start=$(date +%s)
cargo build --release --locked -p lithovm-ffi 2>&1 | tail -5
echo "seconds $(( $(date +%s) - start ))"
ls -la target/release/liblithovm_ffi.so
sha256sum target/release/liblithovm_ffi.so
