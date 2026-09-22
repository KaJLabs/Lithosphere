\set ON_ERROR_STOP on

SELECT current_database() AS observed_database,
       :'expected_db' AS expected_database,
       current_database() = :'expected_db' AS database_identity_matches;

SELECT rolname, rolcanlogin, rolsuper, rolcreaterole, rolcreatedb,
       rolreplication, rolbypassrls
FROM pg_roles
WHERE rolname = :'runtime_role';

SELECT has_database_privilege(:'runtime_role', current_database(), 'CONNECT') AS can_connect,
       has_database_privilege(:'runtime_role', current_database(), 'CREATE') AS can_create_in_database,
       has_schema_privilege(:'runtime_role', 'public', 'USAGE') AS public_schema_usage,
       has_schema_privilege(:'runtime_role', 'public', 'CREATE') AS can_create_in_public;

SELECT table_schema, table_name, privilege_type
FROM information_schema.role_table_grants
WHERE grantee = :'runtime_role'
ORDER BY table_schema, table_name, privilege_type;

SELECT 1 / ((current_database() = :'expected_db')::int) AS database_identity_assertion;

SELECT 1 / ((COUNT(*) = 1)::int) AS restricted_role_assertion
FROM pg_roles
WHERE rolname = :'runtime_role'
  AND rolcanlogin
  AND NOT rolsuper
  AND NOT rolcreaterole
  AND NOT rolcreatedb
  AND NOT rolreplication
  AND NOT rolbypassrls;

SELECT 1 / ((
  has_database_privilege(:'runtime_role', current_database(), 'CONNECT')
  AND NOT has_database_privilege(:'runtime_role', current_database(), 'CREATE')
  AND has_schema_privilege(:'runtime_role', 'public', 'USAGE')
  AND NOT has_schema_privilege(:'runtime_role', 'public', 'CREATE')
)::int) AS database_privilege_assertion;

SELECT 1 / ((COUNT(*) = 0)::int) AS non_select_grant_assertion
FROM information_schema.role_table_grants
WHERE grantee = :'runtime_role' AND privilege_type <> 'SELECT';

SELECT 1 / ((COUNT(*) = 0)::int) AS missing_select_grant_assertion
FROM information_schema.tables AS tables
WHERE tables.table_schema = 'public'
  AND tables.table_type = 'BASE TABLE'
  AND NOT has_table_privilege(
    :'runtime_role',
    format('%I.%I', tables.table_schema, tables.table_name),
    'SELECT'
  );

SELECT 1 / (((
  SELECT COUNT(*) FROM bridge_transactions
  WHERE source_chain IN (900523, 700777, 11155111, 84532, 97)
) + (
  SELECT COUNT(*) FROM bridge_event_cursors
  WHERE chain_id IN (900523, 700777, 11155111, 84532, 97)
) = 0)::int) AS no_testnet_data_assertion;

SELECT COUNT(*) AS public_table_count
FROM information_schema.tables
WHERE table_schema = 'public' AND table_type = 'BASE TABLE';
