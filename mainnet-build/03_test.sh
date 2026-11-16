#!/usr/bin/env bash
# LithoVM port tests on the rc3 base (offline). Tagged = mainnet build; untagged = ordinary rc3 build still rejects lithovm.
set -uo pipefail
W=/home/bachal/litho-mainnet-lithovm-20261116
export PATH="/home/bachal/go1.26.10/bin:$HOME/.cargo/bin:$PATH"
export GOTOOLCHAIN=local GOWORK=off GOOS=linux GOARCH=amd64 GOAMD64=v1 CGO_ENABLED=1 GOFLAGS='' CC=gcc CXX=g++
export GOMAXPROCS=4 GOMEMLIMIT=4GiB
export LD_LIBRARY_PATH="$W/lithic-toolchain/target/release"
TAGS=netgo,ledger,lithovm_chain_lab,lithovm_release
cd "$W/node"
rc=0
echo "== gofmt (changed Go files)"; out=$(gofmt -l app/app.go app/keys.go app/export.go app/lithovm_*.go x/evm/keeper/keeper.go x/evm/keeper/state_transition.go x/evm/keeper/lithovm_*.go); echo "unformatted: ${out:-none}"; [ -z "$out" ] || rc=1
echo "== go vet (tagged)"; go vet -tags "$TAGS" ./app/ ./x/evm/keeper/ || rc=1
echo "== tagged app LithoVM tests"; go test -count=1 -tags "$TAGS" ./app/ -run 'LithoVM' -v 2>&1 | grep -E "^(=== RUN|--- |PASS|FAIL|ok)" || rc=1
echo "== tagged keeper LithoVM tests"; go test -count=1 -tags "$TAGS" ./x/evm/keeper/ -run 'LithoVM' -v 2>&1 | grep -E "^(=== RUN|--- |PASS|FAIL|ok)" | tail -40 || rc=1
echo "== untagged (ordinary rc3 build) LithoVM guards"; go test -count=1 -tags netgo,ledger ./app/ ./x/evm/keeper/ -run 'Ordinary|NotRegisteredByDefault' -v 2>&1 | grep -E "^(--- |PASS|FAIL|ok)" || rc=1
echo "RC=$rc"
