#!/usr/bin/env bash
set -euo pipefail
release_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
release_output="${1:-${release_root}/dist}"
bash "${release_root}/security/build.sh" "${release_output}"
release_output="$(cd "${release_output}" && pwd)"
cd "${release_root}/node"
export GOTOOLCHAIN=local GOWORK=off GOMAXPROCS=2 GOMEMLIMIT=4GiB
GOBIN="${release_output}" go install golang.org/x/vuln/cmd/govulncheck@v1.7.0
"${release_output}/govulncheck" -mode=binary -json "${release_output}/litho-l1-security-20261020-rc2" > "${release_output}/binary-scan.json"
python3 "${release_root}/security/summarize_scan.py" "${release_output}/binary-scan.json"
"${release_output}/govulncheck" -tags=netgo,ledger -json ./cmd/evmosd > "${release_output}/source-scan.json"
python3 "${release_root}/security/summarize_scan.py" "${release_output}/source-scan.json"
python3 "${release_root}/security/check_forks.py"
go test -mod=readonly -p 2 github.com/ethereum/go-ethereum/crypto/secp256k1 github.com/ethereum/go-ethereum/crypto/ecies \
  github.com/cometbft/cometbft/crypto/armor github.com/cosmos/cosmos-sdk/crypto \
  github.com/crypto-org-chain/cronos/memiavl/... github.com/tidwall/wal/... -count=1
go test -mod=readonly -p 2 ./app -run 'TestValidateLITHOGenesisSupply|TestLITHOCrisisModuleUnavailable' -count=1
go test -mod=readonly -p 2 ./app/post -run TestSupplyCapDecorator -count=1
go test -mod=readonly -p 2 ./x/inflation/v1/types -run TestLITHOInflationPermanentlyDisabled -count=1
go test -mod=readonly -p 2 ./x/evm/keeper -run TestKeeperTestSuite/TestSetBalance -count=1
go test -mod=readonly -p 2 ./x/erc20/keeper ./x/ibc/transfer/keeper -count=1
