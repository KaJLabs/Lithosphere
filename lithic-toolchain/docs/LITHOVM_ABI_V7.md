# Native LithoVM artifact and call ABI v7

Status: implementation candidate; staged outbound contract-call intents

Superseded for new compiler output by version 9. Runtime decoding remains
supported.

Target identifier: `lithovm-native-v7`

Version 7 extends version 6 with a typed contract-call statement. The decoder
continues to accept valid version 1 through version 6 artifacts.

## Contract-call statement

`call_contract(target, selector, value);` requires an `address` target, a
`bytes32` selector and a `u256` native value. The runtime requires an explicit
`ExecutionContext` containing the contract's available native balance and the
current call depth. Calls at depth 32 are rejected. The value of each call and
native transfer reduces one shared remaining balance for the execution.

Calls are staged as ordered `ContractCall` records in `ExecutionResult`. Each
record contains the target, selector, value and next call depth. The current VM
does not execute the target synchronously and does not expose return data or a
callback path. Reentrancy cannot occur inside this execution slice.

The runtime host must execute or reject staged calls atomically with returned
storage, event and transfer effects. Missing context, malformed values,
insufficient balance, depth-limit and out-of-gas failures return no result and
expose no calls.

Each call charges the versioned contract-call base cost plus the normal
instruction cost of its target, selector and value expressions.

## Compatibility and current limits

Version 7 retains version 6 transfers, version 5 events, version 4 context,
version 3 transactional storage, structured control flow, canonical values and
checked arithmetic. Versions 1 through 6 retain their existing encodings.

Synchronous execution, return data, calldata beyond the fixed selector,
receipt persistence and consensus application of staged effects remain runtime
integration work. Mutable locals, loops and collection storage remain
unsupported and fail closed.
