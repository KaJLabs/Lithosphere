# Native LithoVM artifact and call ABI v9

Status: implementation candidate; gas-bounded repeat loops

Target identifier: `lithovm-native-v9`

Version 9 adds `repeat count { ... }`. The count must be `u64`, cannot exceed
1,024, and is evaluated once before the loop. Every body statement and
expression is charged normally, so execution also fails when its gas limit is
exhausted. A return inside a loop exits the function; a zero-count loop has no
effects.

Bindings declared inside an iteration are removed after that iteration.
Assignments to inherited mutable bindings persist. Invalid count types,
over-limit counts, malformed bytecode and out-of-gas execution fail closed.

The v9 compiler also lowers typed contract constants into existing constant
instructions. `bytes32` constants may use `keccak256("literal")`; hashing is
performed at compile time over the literal's UTF-8 bytes and adds no runtime
opcode.

Versions 1 through 8 retain their encodings. General `while` loops, unbounded
iteration, recursion and collection storage remain unsupported. Synchronous
call execution and consensus application of staged effects remain integration
work.
