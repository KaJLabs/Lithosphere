# Tracked database migrations

The current native candidate includes migrations 009 through 022. Migration 021
adds immutable wrapped-native redemption plans/evidence and refuses payout drafts
before matching redemption evidence on routes that require it. Migration 022 adds
immutable destination-wallet mode, plan, attempt and transaction bindings. It
refuses adoption when an existing DEX execution already needs an explicit mode
reconciliation. Treat these new
candidate files as immutable once applied; see
[NATIVE_REDEMPTION.md](NATIVE_REDEMPTION.md).

API startup now uses runMigrations rather than executing every SQL file on every
restart. The runner acquires a PostgreSQL advisory transaction lock, verifies
SHA-256 checksums for all recorded files, applies only pending migrations and
records them in multx_schema_migrations. Schema changes and ledger entries commit
together; a failed batch rolls back. Concurrent startups serialize. Missing or
changed applied files, or newly inserted files earlier than applied history, fail
before pending work runs.

Migration files become immutable after application. Correct them with a new,
later-numbered file. Keep deployment file bytes stable, including line endings.
The current migration set contains no transaction-incompatible concurrent indexes
or nested transaction control; future migrations must preserve that contract or
use a separately reviewed migration procedure. This does not promise zero-downtime
DDL or replace deployment backups/rollback planning.

An untracked existing schema is not automatically marked as migrated. Previously
idempotent SQL can run on initial adoption, but a database already containing
untracked native candidate tables may fail CREATE TABLE. Reconcile its exact
schema and migration history before using a reviewed baseline; do not delete
schema objects or invent ledger entries to bypass that failure.

A real disposable PostgreSQL test applies the entire current migration directory,
runs two concurrent initializers, reconnects and confirms a no-op restart, rejects
an altered applied file and verifies rollback of both DDL and ledger state after
an injected SQL failure. The test passed. No production database was changed.
