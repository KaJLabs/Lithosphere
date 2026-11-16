# Native LithoVM artifact and call ABI v1

Status: implementation milestone 1; stateless subset

Superseded for new compiler output by version 2. Runtime decoding remains
supported for compatibility.

Target identifier: `lithovm-native-v1`

This document fixes the first executable boundary shared by `lithc` and the
native `lithovm` crate. It is deliberately small so bytecode decoding,
canonical values, dispatch and gas rejection can be tested before storage and
external effects are introduced.

## Artifact encoding

All integers use unsigned big-endian encoding. An artifact contains:

1. seven-byte ASCII magic `LITHOVM`;
2. one-byte version (`1`);
3. `u16` function count;
4. each function in declaration order:
   - `u16` UTF-8 name length and name bytes;
   - `u16` parameter count and one type byte per parameter;
   - one return-type byte;
   - one return opcode followed by its operand.

Type bytes are `1=u64`, `2=u256`, `3=bool`, `4=address`, and `5=bytes32`.
Return opcode `1` carries one canonical 32-byte constant. Return opcode `2`
carries a `u16` parameter index. Return opcode `3` carries a length-prefixed,
typed postfix expression. Its current instructions load constants/parameters,
perform checked `u64` addition, subtraction, multiplication and division, and
perform equality or `u64` less-than comparison. Decoders validate stack types
and the final return type before execution. Decoders reject unknown versions, types and
opcodes, duplicate function names, invalid identifiers, truncation, trailing
bytes, non-canonical words, bad parameter indexes and type mismatches.

## Calls and values

The caller supplies an exact function name plus an ordered list of 32-byte
arguments. `u64` occupies the low eight bytes, `bool` is zero or one, and an
address occupies the low twenty bytes. `u256` and `bytes32` may use all bytes.
The VM validates every argument before execution.

Gas is deterministic: 10 base units plus 2 units per argument and 1 unit per
expression instruction. Insufficient gas rejects the call without a result.

## Current compiler subset

Functions must be public, synchronous and stateless, use only the five static
types above, and declare a return type. Bodies contain exactly one return.
Returns support a literal, same-typed parameter, parentheses, checked `u64`
arithmetic, equality and `u64` less-than comparison. Any unsupported
declaration or body rejects the whole compilation.

## Next compatible extensions

Version 2 adds immutable local bindings and structured control flow. Version 3
adds transactional scalar storage. Version 4 adds explicit message, block and
chain context. Version 5 adds typed events. Version 6 adds staged native
transfers. Version 7 adds staged outbound contract-call intents. Version 8 adds
typed mutable local bindings. Version 9 adds gas-bounded repeat loops.
Extensions must retain strict decoding and atomic failure.
