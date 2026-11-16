#!/usr/bin/env bash
# Build lithc (lithic-toolchain f7c259ae, Rust 1.96.0) and compile LAX v12: (a) the archived Makalu source, which must
# reproduce code hash 0x280a69...; (b) the mainnet variant with ONLY the INITIAL_HOLDER constant changed.
set -euo pipefail
export PATH="$HOME/.cargo/bin:$PATH"
W=/home/bachal/litho-mainnet-lithovm-20261116; T=$W/lithic-toolchain; O=$W/dist-lax; mkdir -p "$O"
SRC=/mnt/d/Playground/litho-validator-infra/client-work/LAX_POLICY_CANDIDATE_2026-10-14/source/local-workspace/repositories/lithic-toolchain/sdk/contracts/standards/lax_lep100_v12.lithic
cd "$T"
cargo build -p lithc --release --locked 2>&1 | tail -2
echo "lithc sha256 $(sha256sum target/release/lithc | cut -c1-64)  (Makalu manifest pins 97a1515b...)"
cp "$SRC" "$O/lax_lep100_v12.makalu.lithic"
echo "source sha256 $(sha256sum "$O/lax_lep100_v12.makalu.lithic" | cut -c1-64)  (pinned d175f758...)"
python3 - "$O/lax_lep100_v12.makalu.lithic" "$O/lax_lep100_v12.mainnet.lithic" <<'PY'
import sys
s=open(sys.argv[1],encoding='utf-8').read()
old='const INITIAL_HOLDER: address = 0x5AaC0cf0AcF5927C8Bd4D18400350e020DE55F00;'
new='const INITIAL_HOLDER: address = 0x8FDbEe6b479dcaE4627b71D9b053FCa996836aAF;'
assert s.count(old)==1, 'INITIAL_HOLDER line not found exactly once'
open(sys.argv[2],'w',encoding='utf-8',newline='').write(s.replace(old,new))
print('mainnet source: only INITIAL_HOLDER changed')
PY
diff "$O/lax_lep100_v12.makalu.lithic" "$O/lax_lep100_v12.mainnet.lithic" || true
target/release/lithc --emit lithovm "$O/lax_lep100_v12.makalu.lithic" > "$O/lax-v12-artifact.makalu.json"
target/release/lithc --emit lithovm "$O/lax_lep100_v12.mainnet.lithic" > "$O/lax-v12-artifact.mainnet.json"
cp target/release/lithc "$O/lithc"
sha256sum "$O"/*
