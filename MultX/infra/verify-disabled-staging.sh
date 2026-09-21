#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
compose="$root/MultX/infra/docker-compose.disabled-staging.yml"
port="${MULTX_DISABLED_PORT:-4400}"
artifact="${1:-$root/MultX/infra/evidence/MX-O14-O19-$(date -u +%Y%m%dT%H%M%SZ)}"
mkdir -p "$artifact"

container="$(docker compose -f "$compose" ps -q api)"
[[ -n "$container" ]]
[[ "$(docker inspect --format '{{.State.Health.Status}}' "$container")" == healthy ]]

health="$(curl --fail --silent "http://127.0.0.1:$port/health")"
node -e 'const v=JSON.parse(process.argv[1]); if(v.status!=="ok"||v.multx!=="disabled") process.exit(1)' "$health"
printf '%s\n' "$health" > "$artifact/health.json"

for route in bridge tokens chains; do
  code="$(curl --silent --output "$artifact/$route.json" --write-out '%{http_code}' "http://127.0.0.1:$port/$route")"
  [[ "$code" == 503 ]]
  node -e 'const fs=require("fs"); const v=JSON.parse(fs.readFileSync(process.argv[1])); if(v.code!=="MULTX_DISABLED") process.exit(1)' "$artifact/$route.json"
done

git -C "$root" ls-files MultX/api | while IFS= read -r file; do
  digest="$(sha256sum "$root/$file" | awk '{print $1}')"
  relative="${file#MultX/api/}"
  actual="$(docker exec "$container" sha256sum "/app/$relative" | awk '{print $1}')"
  [[ "$digest" == "$actual" ]]
  printf '%s  %s\n' "$digest" "$file"
done > "$artifact/app-source-manifest.txt"

docker inspect --format '{{.Image}}' "$container" > "$artifact/image-id.txt"
docker inspect --format '{{.HostConfig.NetworkMode}} {{json .NetworkSettings.Ports}} {{json .Config.Env}}' "$container" \
  | sed -E 's/(DB_PASSWORD|PRIVATE_KEY|TOKEN|SECRET)=[^" ]+/<redacted>/g' > "$artifact/runtime-state.txt"
docker logs "$container" 2>&1 | sed -E 's#(https?|wss?)://[^ ]+#<endpoint-redacted>#g' > "$artifact/api.log"
grep -F 'MULTX_ENABLED=false; listeners, validators, signing and release relaying are disabled.' "$artifact/api.log" >/dev/null

find "$artifact" -maxdepth 1 -type f ! -name SHA256SUMS -print0 \
  | sort -z | xargs -0 sha256sum > "$artifact/SHA256SUMS"
printf '%s\n' "$artifact"
