# Native LithoVM artifact and call ABI v5

Status: implementation candidate; typed deterministic events

Superseded for new compiler output by version 9. Runtime decoding remains
supported.

Target identifier: `lithovm-native-v5`

Version 5 extends version 4 with ordered event schemas and typed event
emission. The decoder continues to accept valid version 1 through version 4
artifacts.

## Event schemas

After the storage schema, a version 5 artifact encodes an ordered event table.
Each event has a unique identifier and up to 64 uniquely named fields. Event
fields support `u64`, `u256`, `bool`, `address`, and `bytes32`. Event and field
indexes are assigned in declaration order and form part of the artifact.

## Event emission

`emit Name { field: expression }` lowers to a typed event statement. Fields
must appear exactly once in declaration order, and each expression must match
its declared type. Unknown events, reordered fields, missing values, extra
values, type mismatches and invalid indexes reject compilation or decoding.

Successful execution returns ordered `EventRecord` values alongside the return
word and gas usage. Event expressions are metered under the current instruction
schedule. Events remain staged inside execution: any runtime or out-of-gas
failure returns no result, commits no storage and exposes no committed event
records.

## Compatibility and current limits

Version 5 retains version 4 context, version 3 transactional storage,
structured control flow, canonical values and checked arithmetic. Versions 1
through 4 retain their existing encodings.

Event topics, indexed fields, hashing, receipt persistence and explorer/indexer
integration remain runtime integration work. Transfers, contract calls,
reentrancy controls, mutable locals, loops and collection storage remain
unsupported and fail closed.
