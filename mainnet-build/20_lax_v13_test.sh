#!/usr/bin/env bash
# LAX v13 (admin) compile check + host tests in an isolated WSL work dir (does not touch the rehearsal checkout).
set -uo pipefail
export PATH="$HOME/.cargo/bin:$PATH"
SRC=/mnt/d/Playground/litho-validator-infra/local-workspace/repositories/litho-mainnet-lithovm-20261116
X=/home/bachal/lax-v13-work
if [ ! -d "$X/lithic-toolchain" ]; then mkdir -p "$X"; cp -a /home/bachal/litho-mainnet-lithovm-20261116/lithic-toolchain "$X/"; fi
mkdir -p "$X/lax-v13"
cp "$SRC/lax-v13/lax_lep100_v13_admin.lithic" "$X/lax-v13/"
cp "$SRC/lithic-toolchain/packages/vm/lithovm-host/tests/lax_v13_admin.rs" "$X/lithic-toolchain/packages/vm/lithovm-host/tests/"
cd "$X/lithic-toolchain"
echo "== compile check (mainnet source)"
/home/bachal/litho-mainnet-lithovm-20261116/dist-lax/lithc --emit lithovm "$X/lax-v13/lax_lep100_v13_admin.lithic" > "$X/lax-v13/lax-v13-artifact.placeholder-admin.json" && python3 -c 'import json,sys;d=json.load(open(sys.argv[1]));print("compiled",d["contractName"],d["target"],"codeHash",d["codeHash"],"bytes",(len(d["bytecode"])-2)//2,"entrypoints",len(d["entrypoints"]))' "$X/lax-v13/lax-v13-artifact.placeholder-admin.json"
echo "== host tests"
cargo test --release --locked -p lithovm-host --test lax_v13_admin 2>&1 | grep -E "^(test |test result|error|warning: unused)|panicked|FAILED|-->" | head -40
