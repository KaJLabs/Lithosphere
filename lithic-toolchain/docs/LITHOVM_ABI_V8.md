# Native LithoVM artifact and call ABI v8

Status: implementation candidate; typed mutable local bindings

Superseded for new compiler output by version 9. Runtime decoding remains
supported.

Target identifier: `lithovm-native-v8`

Version 8 extends version 7 with explicit mutable local declarations and typed
local assignment. The decoder continues to accept valid version 1 through
version 7 artifacts.

## Mutable local statements

`let mut name: type = expression;` creates a mutable local binding. The type
annotation is optional when the expression type can be inferred. A later
`name = expression;` assignment must target that mutable binding and must
produce the binding's exact static type.

Parameters and locals declared without `mut` remain immutable. Unknown names,
out-of-range indexes, immutable assignments and type mismatches reject the
complete artifact. Runtime assignment also checks that the evaluated value has
the declared type before replacing the local value.

Local bindings remain lexically scoped. Bindings declared inside a selected
branch are removed when that branch completes. Mutations to inherited mutable
bindings take effect within the selected execution path.

## Compatibility and current limits

Version 8 retains version 7 call intents, version 6 transfers, version 5
events, version 4 context, version 3 transactional storage, structured control
flow, canonical values and checked arithmetic. Versions 1 through 7 retain
their existing encodings.

Loops, bounded recursion and collection storage remain unsupported and fail
closed. Synchronous call execution, return data, receipt persistence and
consensus application of staged effects remain runtime integration work.
