#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:?Set BASE_URL to the staging or canary URL}"
MAX_INDEXER_LAG="${MAX_INDEXER_LAG:-5}"

request_code() {
  curl --silent --show-error --output /dev/null --write-out '%{http_code}' --max-time 20 "$1"
}

for path in / /blocks /txs /tokens /validators /api/version /api/config /api/stats/summary; do
  code="$(request_code "${BASE_URL}${path}")"
  [[ "$code" == "200" ]] || { echo "$path returned HTTP $code" >&2; exit 1; }
done

home="$(curl --fail --silent --show-error --max-time 20 "$BASE_URL/")"
grep -q 'data-network="mainnet"' <<<"$home" || { echo "explorer HTML is not branded as mainnet" >&2; exit 1; }
grep -qi 'Lithoscan' <<<"$home" || { echo "explorer HTML is missing Lithoscan branding" >&2; exit 1; }
[[ "$(request_code "$BASE_URL/litho-coin-logo.svg")" == "200" ]] || { echo "LITHO coin logo is unavailable" >&2; exit 1; }

for spec in 'faucet:No faucet on mainnet' 'bridge:Bridge is not enabled' 'swap:Swap is not enabled' 'cross-swap:Cross-chain swap is not enabled'; do
  path="${spec%%:*}"
  expected="${spec#*:}"
  body="$(curl --fail --silent --show-error --max-time 20 "$BASE_URL/$path")"
  body="${body//<!-- -->/}"
  grep -q "$expected" <<<"$body" || { echo "/$path does not fail closed in the UI" >&2; exit 1; }
done

config="$(curl --fail --silent --show-error --max-time 20 "$BASE_URL/api/config")"
[[ "$(jq -r '.network.evmChainId' <<<"$config")" == "9005" ]] || { echo "API does not report EVM chain 9005" >&2; exit 1; }
[[ "$(jq -r '.network.cosmosChainId' <<<"$config")" == "lithosphere_9005-1" ]] || { echo "API reports the wrong Cosmos chain" >&2; exit 1; }
[[ "$(jq -r '.features.faucet' <<<"$config")" == "false" ]] || { echo "Faucet is enabled" >&2; exit 1; }
[[ "$(jq -r '.features.bridge' <<<"$config")" == "false" ]] || { echo "Bridge/MultX is enabled" >&2; exit 1; }
[[ "$(jq -r '.features.swap' <<<"$config")" == "false" ]] || { echo "Swap is enabled" >&2; exit 1; }

for disabled_path in /api/faucet/info /api/bridge/config; do
  code="$(request_code "${BASE_URL}${disabled_path}")"
  [[ "$code" == "404" ]] || { echo "$disabled_path must return 404, got $code" >&2; exit 1; }
done

for attempt in {1..6}; do
stats="$(curl --fail --silent --show-error --max-time 30 "$BASE_URL/api/stats/summary")"
chain_tip="$(jq -r '.chainTipHeight // 0' <<<"$stats")"
indexed_tip="$(jq -r '.tipHeight // 0' <<<"$stats")"
lag="$(jq -r '.syncLagBlocks // 999999999' <<<"$stats")"
syncing="$(jq -r 'if .isSyncing == null then true else .isSyncing end' <<<"$stats")"
inconsistent="$(jq -r '.inconsistentBlocks // 1' <<<"$stats")"

(( chain_tip > 0 && indexed_tip > 0 )) || { echo "chain/indexer has not produced blocks" >&2; exit 1; }
[[ "$syncing" == "false" ]] || { echo "indexer still reports syncing" >&2; exit 1; }
[[ "$inconsistent" == "0" ]] || { echo "indexer reports $inconsistent inconsistent blocks" >&2; exit 1; }
(( lag <= MAX_INDEXER_LAG )) && break
# Block ingestion runs in batches; recheck brief lag spikes without relaxing the limit.
[[ "$attempt" != "6" ]] || { echo "indexer lag $lag exceeds $MAX_INDEXER_LAG after six checks" >&2; exit 1; }
echo "Indexer lag $lag exceeds $MAX_INDEXER_LAG; rechecking in 10 seconds ($attempt/6)"
sleep 10
done

echo "Staging smoke tests passed: chain_tip=$chain_tip indexed_tip=$indexed_tip lag=$lag"
