# Native LithoVM artifact and call ABI v2

Status: implementation candidate; stateless typed statements

Superseded for new compiler output by version 9. Runtime decoding remains
supported for compatibility.

Target identifier: `lithovm-native-v2`

Version 2 extends the version 1 static-value ABI with immutable local bindings
and structured `if`/`else` control flow. The decoder continues to accept valid
version 1 artifacts. Version 2 remains stateless and has no external effects.

## Statement encoding

A function may use a statement body. Blocks are length-prefixed and contain:

- `let`: a value type followed by a typed postfix expression;
- `return`: a typed postfix expression matching the function return type;
- `if`: a boolean postfix condition followed by complete `then` and `else`
  blocks.

Expressions add a local-slot load instruction. Local slots are immutable,
assigned in declaration order and scoped to their branch. Every block must
return on every path. Missing `else` branches, unreachable statements,
mutable locals, invalid slot references and type mismatches reject the entire
artifact.

## Execution and limits

The runtime evaluates only the selected branch. Arithmetic faults in an
unselected branch do not execute. Gas includes the base call and parameter
cost, then charges each executed statement and expression instruction.

The bytecode validator limits functions to 256 local slots, 4,096 statements
per block, 4,096 instructions per expression and 64 nested blocks. Compiler
limits also cap the total statements in a function. Checked `u64` arithmetic,
canonical values and strict decoding retain the version 1 behavior.

## Unsupported behavior

Loops, mutable variables, storage, events, transfers, external calls and
recursion are not part of version 2. The compiler rejects these features rather
than omitting their behavior.
