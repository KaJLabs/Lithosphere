# Native contract status and verification candidate

`explorerRouter()` mounts `/native` in a disabled state (503 before RPC, worker
or database access). Only explicit owner-installed `NativeContractDependencies`
can enable the adapter. This change installs no live profile or migration.

- `GET /native/deployments/:hash` observes the configured chain receipt, or
  returns unknown when no receipt exists. It never infers submission from a hash.
- `POST /native/contracts/:address/verify` accepts only `transactionHash` and
  `request` (the existing lithovm-verification-v1 source bundle). Receipts, raw
  comparison code and RPC URLs cannot be supplied by the requester.
- `GET /native/contracts/:address/source` returns a saved match only while its
  observed block remains canonical. Responses are not cached.

`evmNativeReceiptReader` reads the outer transaction and receipt from a fixed
operator RPC. `cometNativeRecordReader` reads `/store/lithovm/key` at the exact
height and checks the Comet block hash against the EVM observation before and
after the query. Different node/height/hash, missing/pruned records, wrong key,
invalid encoding, excessive size and query errors fail closed. These trusted-RPC
reads are not consensus-proof verification.

`assertRuntime` must independently enforce the accepted chain/runtime/gateway
profile. A user source bundle or static frontend claim is not runtime evidence.
It is intentionally a required installation dependency with no guessed default.
The final installed profile must include the matching chain build, gateway,
worker hashes, historical-state availability and protected RPC configuration.

`pinnedNativeWorkers` checks absolute executable paths, regular non-symlink
files and exact SHA-256 before spawning local Rust workers with bounded time,
concurrency and output. Install executables read-only for the API service user.
Source is written to private temporary files and never interpolated into shell
commands. Worker stderr is not returned to HTTP callers. Rejected source is not
stored or published. The verifier decodes native records using the same FFI
codec as the runtime; JavaScript does not reimplement that storage format.

Apply `migrations/20261106_native_source_matches.sql` only during an approved
installation, then supply `postgresNativeSources(pool)`. Each saved source is
bound to its block-aware deployment ID, code hash and canonical registration.
Reorg checks invalidate orphaned matches. Source-match status does not establish
state correctness, consensus finality or physical-storage durability.

Build/test: `pnpm exec tsc` and `pnpm test`. On Linux, after building the matching
Rust candidate, `node scripts/native-worker-smoke.mjs BINARY_DIR REPORT.json`
tests the actual pinned decoder/verifier and full service boundary against the
shared synthetic compiler/FFI fixture. It opens no RPC or database connection.
The default API tests omit the existing database integration suite unless its
explicit test environment is configured; that limitation must remain disclosed.

The original v17 review packet, R6.4 closeout and failed 50M result remain intact.
No production deployment, LAX, MultX, bridge or Swap activation is included.
