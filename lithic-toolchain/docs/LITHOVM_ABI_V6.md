# Native LithoVM artifact and call ABI v6

Status: implementation candidate; staged native-value transfers

Superseded for new compiler output by version 9. Runtime decoding remains
supported.

Target identifier: `lithovm-native-v6`

Version 6 extends version 5 with a typed native-value transfer statement. The
decoder continues to accept valid version 1 through version 5 artifacts.

## Transfer statement

`transfer_native(recipient, amount);` requires an `address` recipient and a
`u256` amount. The runtime requires an explicit `ExecutionContext` containing
the contract's available native balance. Each transfer reduces the remaining
balance for that execution, so cumulative transfers cannot exceed the supplied
balance.

Transfers are staged as ordered `NativeTransfer` records in `ExecutionResult`.
The runtime host must apply them atomically with the returned storage and event
effects. Missing context, malformed values, insufficient balance, arithmetic
failure and out-of-gas failure return no result and expose no transfers.

Each transfer charges the versioned native-transfer base cost plus the normal
instruction cost of its recipient and amount expressions.

## Compatibility and current limits

Version 6 retains version 5 events, version 4 context, version 3 transactional
storage, structured control flow, canonical values and checked arithmetic.
Versions 1 through 5 retain their existing encodings.

Contract calls, reentrancy/call-depth policy, receipt persistence and consensus
application of transfer effects remain runtime integration work. Mutable locals,
loops and collection storage remain unsupported and fail closed.
