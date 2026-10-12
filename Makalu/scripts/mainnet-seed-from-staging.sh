#!/usr/bin/env bash
set -euo pipefail

DEPLOY_DIR="${DEPLOY_DIR:-/opt/lithoscan-mainnet}"
COMPOSE_FILE="$DEPLOY_DIR/docker-compose.mainnet.yaml"
ENV_FILE="$DEPLOY_DIR/.env"
STAGING_POSTGRES=lithoscan-mainnet-staging-postgres-1
PRODUCTION_POSTGRES=lithoscan-mainnet-postgres-1
PRODUCTION_REDIS=lithoscan-mainnet-redis-1
STAGING_DB=lithoscan_mainnet_staging
PRODUCTION_DB=lithoscan_mainnet
EXPECTED_CHAIN_ID=lithosphere_9005-1
EXPECTED_GENESIS_HASH=7418c1962b64597ee91d6747ece3d5325c8b17b261e4c0e4a109a9bafe74f509

[[ -f "$COMPOSE_FILE" && -f "$ENV_FILE" ]] || { echo "production compose package is missing" >&2; exit 1; }
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a
[[ "${COMPOSE_PROJECT_NAME:-}" == "lithoscan-mainnet" && "${POSTGRES_DB:-}" == "$PRODUCTION_DB" ]] || {
  echo "refusing seed: target is not the isolated production project" >&2; exit 1;
}

staging_project="$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project"}}' "$STAGING_POSTGRES")"
production_project="$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project"}}' "$PRODUCTION_POSTGRES")"
[[ "$staging_project" == "lithoscan-mainnet-staging" && "$production_project" == "lithoscan-mainnet" ]] || {
  echo "refusing seed: Docker project identities are not isolated" >&2; exit 1;
}

staging_chain="$(docker exec "$STAGING_POSTGRES" psql -U "$STAGING_DB" -d "$STAGING_DB" -Atc "SELECT value FROM indexer_state WHERE key = 'chain_id'")"
staging_genesis="$(docker exec "$STAGING_POSTGRES" psql -U "$STAGING_DB" -d "$STAGING_DB" -Atc "SELECT value FROM indexer_state WHERE key = 'genesis_hash'")"
staging_min="$(docker exec "$STAGING_POSTGRES" psql -U "$STAGING_DB" -d "$STAGING_DB" -Atc 'SELECT COALESCE(MIN(height), 0) FROM blocks')"
staging_max="$(docker exec "$STAGING_POSTGRES" psql -U "$STAGING_DB" -d "$STAGING_DB" -Atc 'SELECT COALESCE(MAX(height), 0) FROM blocks')"
[[ "$staging_chain" == "$EXPECTED_CHAIN_ID" && "$staging_genesis" == "$EXPECTED_GENESIS_HASH" ]] || {
  echo "refusing seed: staging chain identity is not LITHO mainnet" >&2; exit 1;
}
[[ "$staging_min" == "1" && "$staging_max" -gt 0 ]] || {
  echo "refusing seed: staging block range is inconsistent with LITHO mainnet" >&2; exit 1;
}

production_max="$(docker exec "$PRODUCTION_POSTGRES" psql -U "$PRODUCTION_DB" -d "$PRODUCTION_DB" -Atc 'SELECT COALESCE(MAX(height), 0) FROM blocks')"
# Seeding is a bootstrap operation, never a release-time replacement of live data.
if (( production_max == 0 )); then
  echo "Seeding isolated production database from verified mainnet staging snapshot at height $staging_max"
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" stop explorer api indexer
  docker exec "$STAGING_POSTGRES" pg_dump -U "$STAGING_DB" -d "$STAGING_DB" --format=custom --no-owner --no-privileges \
    | docker exec -i "$PRODUCTION_POSTGRES" pg_restore -U "$PRODUCTION_DB" -d "$PRODUCTION_DB" \
        --clean --if-exists --no-owner --no-privileges --single-transaction --exit-on-error
  docker exec "$PRODUCTION_POSTGRES" psql -U "$PRODUCTION_DB" -d "$PRODUCTION_DB" -v ON_ERROR_STOP=1 -c 'ANALYZE' >/dev/null
  docker exec "$PRODUCTION_REDIS" redis-cli -a "$REDIS_PASSWORD" FLUSHDB >/dev/null
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d api indexer explorer
fi

production_chain="$(docker exec "$PRODUCTION_POSTGRES" psql -U "$PRODUCTION_DB" -d "$PRODUCTION_DB" -Atc "SELECT value FROM indexer_state WHERE key = 'chain_id'")"
production_genesis="$(docker exec "$PRODUCTION_POSTGRES" psql -U "$PRODUCTION_DB" -d "$PRODUCTION_DB" -Atc "SELECT value FROM indexer_state WHERE key = 'genesis_hash'")"
production_min="$(docker exec "$PRODUCTION_POSTGRES" psql -U "$PRODUCTION_DB" -d "$PRODUCTION_DB" -Atc 'SELECT COALESCE(MIN(height), 0) FROM blocks')"
production_max="$(docker exec "$PRODUCTION_POSTGRES" psql -U "$PRODUCTION_DB" -d "$PRODUCTION_DB" -Atc 'SELECT COALESCE(MAX(height), 0) FROM blocks')"
[[ "$production_chain" == "$EXPECTED_CHAIN_ID" && "$production_genesis" == "$EXPECTED_GENESIS_HASH" && "$production_min" == "1" ]] || {
  echo "production database identity verification failed after seed" >&2; exit 1;
}
(( production_max > 0 )) || { echo "production database has no indexed blocks" >&2; exit 1; }
echo "Isolated production database verified at height $production_max"
