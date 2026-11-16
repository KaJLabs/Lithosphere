#!/usr/bin/env bash
set -uo pipefail
W=/home/bachal/litho-mainnet-lithovm-20261116
export PATH="/home/bachal/go1.26.10/bin:$HOME/.cargo/bin:$PATH"
export GOTOOLCHAIN=local GOWORK=off GOOS=linux GOARCH=amd64 GOAMD64=v1 CGO_ENABLED=1 GOFLAGS='' CC=gcc CXX=g++ GOMAXPROCS=4 GOMEMLIMIT=4GiB
export LD_LIBRARY_PATH="$W/lithic-toolchain/target/release"
cd "$W/node"
echo "== gofmt -d app/lithovm_upgrade_lab_test.go"; gofmt -d app/lithovm_upgrade_lab_test.go | head -30
echo "== suite: LithoVM candidate apply + signed deploy/commit"
go test -count=1 -tags netgo,ledger,lithovm_chain_lab,lithovm_release ./x/evm/keeper/ -run "${SUITE:-TestKeeperTestSuite}" -testify.m 'LithoVMCandidate' -v 2>&1 | grep -E "^(=== RUN|    --- |--- |PASS|FAIL|ok)|panic|Error" | tail -30
