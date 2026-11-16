# Local compiler/execution experiment

Status: experimental, non-publishable, not the production LithoVM format.

The public runtime currently validates a container but does not execute contract
instructions. Its architecture documents list services, without an instruction
encoding, gas schedule or deployment interface. This experiment gives us a
small executable test while those production interfaces are specified.

## Run

```sh
cargo run --locked -p lithovm-lab -- apps/examples/frontend/lab-answer.lithic
cargo test --locked -p lithovm-lab
```

Expected result: `return=42; gas_used=1; production_compatible=false`.
The CLI compiles and runs in memory; it has no RPC, deployment or signing path.
This experiment predates and is separate from the executable EVM backend in
[EVM backend v1](EVM_BACKEND_V1.md). It does not make LEP100-15 executable.

## Deliberately narrow local contract

Exactly one contract with one `pub fn NAME() -> u64 { return INTEGER; }`.
The complete source must match this subset; no unsupported declarations or
capabilities are dropped. Input is limited to 4096 ASCII bytes by the compiler
library. Literal values range from zero to 2^64-1. The local format has a single
unnamed entrypoint, so contract/function names are not encoded or dispatched.
No source hash or deployment ABI is claimed.

| Bytes | Meaning |
|---|---|
| 0–6 | ASCII LITHLAB, intentionally distinct from LITHOVM |
| 7 | Experimental version 1 |
| 8 | Opcode 1: return immediate u64 |
| 9–16 | Unsigned big-endian return value |

Exactly 17 bytes are accepted. Invalid version/opcode/header, truncation and
trailing data fail before execution. Execution consumes one laboratory gas
unit; a zero gas budget fails. No storage or external effects exist.

Tests cover independent byte-vector decoding, deterministic compilation,
numeric boundaries/overflow, unsupported source rejection, malformed artifacts,
legacy dummy artifacts and insufficient gas. This is not a full language,
security review or cross-VM conformance test.

## Production interface decisions still required

1. Bytecode/object format, version negotiation and instruction set.
2. Public function dispatch, argument/return encoding and integer types.
3. Stack/memory/storage limits, persistent-state layout and metering.
4. Atomic rollback, nested calls, native transfers and EVM interoperation.
5. Signature verification, caller identity, chain/account domain binding.
6. Deployment transaction format, runtime module/binary and code provenance.

The next meaningful extension is typed expression/body parsing against an
explicit language specification, followed by state/rollback tests. LEP100-15
requires authorization and signature semantics as well as parsing. None of
these production rules should be inferred from this one-instruction lab.
