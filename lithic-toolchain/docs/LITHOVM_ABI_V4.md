# Native LithoVM artifact and call ABI v4

Status: implementation candidate; explicit deterministic host context

Superseded for new compiler output by version 9. Runtime decoding remains
supported.

Target identifier: `lithovm-native-v4`

Version 4 extends version 3 with typed message, block and chain context. The
decoder continues to accept valid version 1, version 2 and version 3 artifacts.

## Context values

The compiler lowers these read-only expressions:

| Lithic expression | Type | Runtime source |
|---|---|---|
| `msg.sender` | `address` | authenticated caller |
| `msg.value` | `u256` | native value attached to the call |
| `block.height` | `u64` | current consensus block height |
| `block.timestamp` | `u64` | current consensus timestamp |
| `chain.id` | `u64` | current chain identifier |

The host supplies all context through `ExecutionContext`. Callers must use
`Vm::execute_with_context` for stateless artifacts or
`Vm::execute_with_storage_and_context` for stateful artifacts. Executing a
context instruction without an explicit context fails. The runtime validates
the canonical caller word before execution.

Context reads cost one instruction gas unit under the current candidate gas
schedule. They are deterministic inputs and cannot be changed by contract code.
Failures preserve the version 3 transactional storage rollback guarantee.

## Compatibility and current limits

Version 4 retains the version 3 storage schema, atomic commit, structured
control flow, canonical values and checked arithmetic. Version 1, version 2 and
version 3 artifacts retain their existing encodings.

Events, transfers, contract calls, mutable local variables, loops, collection
storage and recursion remain unsupported and fail closed. Production consensus
integration must bind `ExecutionContext` to authenticated transaction and block
data; library execution alone does not establish that binding.
