# Native LithoVM artifact and call ABI v3

Status: implementation candidate; transactional scalar storage

Superseded for new compiler output by version 9. Runtime decoding remains
supported.

Target identifier: `lithovm-native-v3`

Version 3 extends version 2 with a deterministic scalar storage schema,
storage reads and storage assignments. The decoder continues to accept valid
version 1 and version 2 artifacts.

## Storage schema

After the version byte, a version 3 artifact encodes a length-prefixed ordered
list of storage fields. Each field contains its identifier and one canonical
value type. Supported field types are `u64`, `u256`, `bool`, `address`, and
`bytes32`. Field indexes are assigned in declaration order and are part of the
artifact. Missing values initialize to the canonical zero word.

Maps, vectors, initializers and storage-layout migrations are not supported in
this version. Unknown fields, duplicate names, invalid indexes, type mismatches
and non-canonical stored words reject execution.

## Reads, writes and transactions

`self.field` lowers to a typed storage-read instruction. A statement of the
form `self.field = expression;` lowers to a typed storage write. The expression
must match the declared field type.

Stateful artifacts must execute through `Vm::execute_with_storage`. The runtime
clones the supplied state, validates and initializes the staged copy, executes
against it, and replaces the caller's state only after a successful return.
Parse errors, invalid input, arithmetic faults, out-of-gas failures and all
other errors leave the original state byte-for-byte unchanged. Stateless
`Vm::execute` rejects stateful artifacts so persistence cannot be accidentally
discarded.

## Compatibility and current limits

Version 1 and version 2 artifacts retain their existing encodings and execute
without a storage schema. Version 3 retains immutable locals, structured
`if`/`else`, canonical values, checked arithmetic and executed-path gas
metering.

Events, external calls, transfers, loops, mutable local variables, collections
and recursion remain unsupported and fail closed.
