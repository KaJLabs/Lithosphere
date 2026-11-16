#!/usr/bin/env bash
# Build the mainnet lithod = rc3 (security/build.sh settings) + LithoVM (tags lithovm_chain_lab,lithovm_release),
# linked against the pinned liblithovm_ffi (same bytes as Makalu R4, b96a9028...), rpath $ORIGIN/../lib as on Makalu.
set -euo pipefail
W=/home/bachal/litho-mainnet-lithovm-20261116
GOROOT_DIR=/home/bachal/go1.26.10
if [ ! -x "$GOROOT_DIR/bin/go" ]; then
  mkdir -p "$GOROOT_DIR.tmp"; tar -xzf /home/bachal/litho-l1-security-rc3-20261021/go1.26.10.linux-amd64.tar.gz -C "$GOROOT_DIR.tmp"
  mv "$GOROOT_DIR.tmp/go" "$GOROOT_DIR"; rmdir "$GOROOT_DIR.tmp"
fi
export PATH="$GOROOT_DIR/bin:$HOME/.cargo/bin:$PATH"
release_version=litho-l1-security-20261021-rc3-lithovm1
out="$W/dist-lithovm"
export GOTOOLCHAIN=local GOWORK=off GOOS=linux GOARCH=amd64 GOAMD64=v1 CGO_ENABLED=1
export GOFLAGS='' GOEXPERIMENT='' CC=gcc CXX=g++
export GOMAXPROCS="${GOMAXPROCS:-4}" GOMEMLIMIT="${GOMEMLIMIT:-4GiB}"
export CGO_LDFLAGS='-Wl,-rpath,$ORIGIN/../lib'
[[ "$(go version)" == 'go version go1.26.10 linux/amd64' ]] || { echo 'Requires Go 1.26.10' >&2; exit 1; }
test "$(sha256sum "$W/lithic-toolchain/target/release/liblithovm_ffi.so" | cut -c1-64)" = b96a9028219b2abc8c4557bdf7cd74e2ffb096ed3b1ce962e17e4a40f9ad473c
mkdir -p "$out"
cd "$W/node"
start=$(date +%s)
go build -mod=readonly -buildvcs=false -p 4 -tags netgo,ledger,lithovm_chain_lab,lithovm_release -trimpath \
  -ldflags "-X github.com/cosmos/cosmos-sdk/version.Name=lithod -X github.com/cosmos/cosmos-sdk/version.AppName=lithod -X github.com/cosmos/cosmos-sdk/version.Version=${release_version}" \
  -o "$out/$release_version" ./cmd/evmosd
echo "build seconds $(( $(date +%s) - start ))"
go version -m "$out/$release_version" > "$out/build-metadata.txt"
mkdir -p "$out/lib" && cp "$W/lithic-toolchain/target/release/liblithovm_ffi.so" "$out/lib/"
sha256sum "$out/$release_version" "$out/lib/liblithovm_ffi.so"
readelf -d "$out/$release_version" | grep -E "NEEDED|RUNPATH|RPATH"
