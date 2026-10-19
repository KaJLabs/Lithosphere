#!/usr/bin/env bash
set -euo pipefail
release_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
release_output="${1:-${release_root}/dist}"
release_version=litho-l1-security-20261020-rc2
export GOTOOLCHAIN=local GOWORK=off GOOS=linux GOARCH=amd64 GOAMD64=v1 CGO_ENABLED=1
export GOFLAGS='' GOEXPERIMENT='' CC=gcc CXX=g++
export GOMAXPROCS="${GOMAXPROCS:-2}" GOMEMLIMIT="${GOMEMLIMIT:-4GiB}"
[[ "$(go version)" == 'go version go1.26.9 linux/amd64' ]] || { echo 'Requires the pinned Go 1.26.9 linux/amd64 compiler' >&2; exit 1; }
mkdir -p "${release_output}"
release_output="$(cd "${release_output}" && pwd)"
cd "${release_root}/node"
go mod verify
go build -mod=readonly -buildvcs=false -p 2 -tags netgo,ledger -trimpath \
  -ldflags "-X github.com/cosmos/cosmos-sdk/version.Name=lithod -X github.com/cosmos/cosmos-sdk/version.AppName=lithod -X github.com/cosmos/cosmos-sdk/version.Version=${release_version}" \
  -o "${release_output}/${release_version}" ./cmd/evmosd
go version -m "${release_output}/${release_version}" > "${release_output}/build-metadata.txt"
sha256sum "${release_output}/${release_version}"
