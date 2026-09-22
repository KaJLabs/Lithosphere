#!/bin/sh
set -eu

app_password="$(cat /run/secrets/db-app-password)"
psql --set ON_ERROR_STOP=on \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" \
  --set app_password="$app_password" <<'SQL'
SELECT format(
  'CREATE ROLE multx_staging_app LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS',
  :'app_password'
) WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'multx_staging_app') \gexec

GRANT CONNECT ON DATABASE multx_mainnet_staging TO multx_staging_app;
GRANT USAGE ON SCHEMA public TO multx_staging_app;
REVOKE CREATE ON DATABASE multx_mainnet_staging FROM multx_staging_app;
REVOKE CREATE ON SCHEMA public FROM multx_staging_app;
ALTER DEFAULT PRIVILEGES FOR ROLE multx_staging_owner IN SCHEMA public
  GRANT SELECT ON TABLES TO multx_staging_app;
SQL
unset app_password
