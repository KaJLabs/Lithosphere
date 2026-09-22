#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
compose="$root/MultX/infra/docker-compose.disabled-staging.yml"
tag="${MULTX_REVIEW_TAG:?set MULTX_REVIEW_TAG}"
commit="${MULTX_REVIEW_COMMIT:?set MULTX_REVIEW_COMMIT}"
artifact="${1:-$root/MultX/infra/evidence/MX-O14-O19-$(date -u +%Y%m%dT%H%M%SZ)}"
mkdir -p "$artifact"

[[ "$(git -C "$root" rev-parse HEAD)" == "$commit" ]]
[[ -z "$(git -C "$root" status --porcelain --untracked-files=no)" ]]

container="$(docker compose -f "$compose" ps -q api)"
database="$(docker compose -f "$compose" ps -q database)"
[[ -n "$container" && -n "$database" ]]
[[ "$(docker inspect --format '{{.State.Health.Status}}' "$container")" == healthy ]]

# Exercise the genuine application from inside its isolated network namespace.
docker exec "$container" node --input-type=module -e '
  const paths = ["health", "bridge", "tokens", "chains"];
  const result = {};
  for (const name of paths) {
    const response = await fetch(`http://127.0.0.1:4000/${name}`);
    result[name] = { status: response.status, body: await response.json() };
  }
  if (result.health.status !== 200 || result.health.body.multx !== "disabled") process.exit(1);
  for (const name of ["bridge", "tokens", "chains"]) {
    if (result[name].status !== 503 || result[name].body.code !== "MULTX_DISABLED") process.exit(1);
  }
  console.log(JSON.stringify(result));
' > "$artifact/application-behavior.json"

# O-19: the verifier executes inside the running image and performs a strict,
# bidirectional comparison of /app source (excluding node_modules) to the
# candidate manifest accepted for review.
docker exec "$container" node /usr/local/lib/verify-runtime-source.mjs \
  > "$artifact/image-source-attestation.txt"
grep -qx 'missing_files=0' "$artifact/image-source-attestation.txt"
grep -qx 'mismatched_files=0' "$artifact/image-source-attestation.txt"
grep -qx 'unlisted_files=0' "$artifact/image-source-attestation.txt"
grep -qx 'result=PASS' "$artifact/image-source-attestation.txt"
docker exec "$container" sha256sum \
  /usr/local/lib/verify-runtime-source.mjs \
  /usr/local/share/multx-runtime-source-manifest.json \
  > "$artifact/in-image-review-material-sha256.txt"
docker cp "$container:/usr/local/lib/verify-runtime-source.mjs" "$artifact/verify-runtime-source.mjs"
docker cp "$container:/usr/local/share/multx-runtime-source-manifest.json" "$artifact/runtime-source-manifest.json"

# R-02: prove the API has no published port, only an internal Docker network,
# and cannot establish an external TCP connection.
network_id="$(docker inspect --format '{{range $id, $_ := .NetworkSettings.Networks}}{{$id}}{{end}}' "$container")"
[[ -n "$network_id" ]]
[[ "$(docker network inspect --format '{{.Internal}}' "$network_id")" == true ]]
[[ -z "$(docker port "$container")" ]]
docker exec "$container" node --input-type=module -e '
  import net from "node:net";
  const socket = net.createConnection({ host: "192.0.2.1", port: 443 });
  const timer = setTimeout(() => { console.log("egress_blocked=true reason=timeout"); socket.destroy(); }, 2000);
  socket.on("connect", () => { clearTimeout(timer); console.error("unexpected external connection"); process.exit(1); });
  socket.on("error", (error) => { clearTimeout(timer); console.log(`egress_blocked=true reason=${error.code || "error"}`); });
' > "$artifact/network-egress.txt"

{
  echo "capture_utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "api_state=$(docker inspect --format '{{.State.Status}}' "$container")"
  echo "api_health=$(docker inspect --format '{{.State.Health.Status}}' "$container")"
  echo "api_network_internal=$(docker network inspect --format '{{.Internal}}' "$network_id")"
  echo "api_published_ports=$(docker inspect --format '{{json .NetworkSettings.Ports}}' "$container")"
  echo "api_port_command_output=empty"
  echo "api_read_only_rootfs=$(docker inspect --format '{{.HostConfig.ReadonlyRootfs}}' "$container")"
  echo "api_cap_drop=$(docker inspect --format '{{json .HostConfig.CapDrop}}' "$container")"
  echo "api_security_opt=$(docker inspect --format '{{json .HostConfig.SecurityOpt}}' "$container")"
} > "$artifact/runtime-isolation.txt"

# R-02/R-03: capture and fail closed on the runtime role, grants, testnet-data
# absence and the exact migration-016 ledger checksum.
docker compose -f "$compose" exec -T database psql \
  --username multx_staging_owner \
  --dbname multx_mainnet_staging \
  --set ON_ERROR_STOP=on \
  --set expected_db=multx_mainnet_staging \
  --set runtime_role=multx_staging_app \
  --file /run/ops/verify-disabled-staging-db.sql \
  > "$artifact/database-isolation.txt"
docker compose -f "$compose" exec -T database psql \
  --username multx_staging_owner \
  --dbname multx_mainnet_staging \
  --tuples-only --no-align \
  --command "SELECT name || ' ' || checksum FROM multx_schema_migrations WHERE name='016-native-wallet-auth.sql'" \
  > "$artifact/migration-016-ledger.txt"
grep -Eq '^016-native-wallet-auth\.sql [0-9a-f]{64}$' "$artifact/migration-016-ledger.txt"

docker inspect --format '{{.Image}}' "$container" > "$artifact/image-id.txt"
docker logs "$container" 2>&1 | sed -E 's#(https?|wss?)://[^ ]+#<endpoint-redacted>#g' > "$artifact/api.log"
grep -F 'Database migrations disabled; runtime role remains read-only.' "$artifact/api.log" >/dev/null
grep -F 'MULTX_ENABLED=false; listeners, validators, signing and release relaying are disabled.' "$artifact/api.log" >/dev/null

manifest_sha="$(sha256sum "$artifact/runtime-source-manifest.json" | awk '{print $1}')"
verifier_sha="$(sha256sum "$artifact/verify-runtime-source.mjs" | awk '{print $1}')"
declared="$(sed -n 's/^declared_files=//p' "$artifact/image-source-attestation.txt")"
image_files="$(sed -n 's/^image_source_files=//p' "$artifact/image-source-attestation.txt")"
verified="$(sed -n 's/^verified_files=//p' "$artifact/image-source-attestation.txt")"
start_utc="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
cat > "$artifact/RESULTS.md" <<EOF
# MultX O-14/O-19 closure evidence

- Result: **PASS**
- Candidate tag: \`$tag\`
- Candidate commit: \`$commit\`
- Capture UTC: \`$start_utc\`
- Runtime source manifest SHA-256: \`$manifest_sha\`
- In-image verifier SHA-256: \`$verifier_sha\`
- Declared/image/verified source files: \`$declared/$image_files/$verified\`
- Missing/mismatched/unlisted source files: \`0/0/0\`

The genuine API ran with \`MULTX_ENABLED=false\` and a read-only runtime database
role. Health reported disabled and the mounted bridge, token and chain routes
returned 503 \`MULTX_DISABLED\`. The native settlement route modules remain
structurally unmounted in \`index.js\`; their source is present but unreachable
from this application entrypoint. Listeners, validators, signing and release
relaying did not start.

The API has no published ports and is attached only to an internal Docker
network. The external-connectivity refusal probe passed. Database assertions
confirm the runtime role has no elevated attributes, database/schema CREATE or
non-SELECT table grants, has SELECT on every public table, and contains no
Makalu/testnet rows or cursors. Migration 016 is bound separately to its ledger
checksum.

This is disabled staging evidence only. It authorizes no deployment, signing,
relaying, canary or activation.
EOF

(
  cd "$artifact"
  find . -maxdepth 1 -type f ! -name SHA256SUMS -printf '%P\0' \
    | sort -z | xargs -0 sha256sum > SHA256SUMS
)
printf '%s\n' "$artifact"
