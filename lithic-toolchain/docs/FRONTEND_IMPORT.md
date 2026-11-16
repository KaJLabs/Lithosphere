# Tested front-end import

Imported from KaJLabs/Lithosphere snapshot
`cee91f54186b6f07de08ad090394bfa2f46e6793`, under `toolchain/crates/`:
`lithic-syntax`, `lithc`, `lithfmt` and `lithlint`, including their existing tests.
The original front-end commit is `e0dbcf6795f879bf7d0092fff419cba10049bd44`
(bachal-abro); conservative checks were added in `d675555` (bachal-mb).
Source history remains available in that repository; this is a source import,
not a merge of its unrelated chain and infrastructure history.

Golden contract fixtures are copied unchanged from the source snapshot's
`Makalu/contracts/src`. They are parser fixtures, not deployment examples.
The golden-test path is local to this repository. Package versions retain the
destination workspace's 0.1.0 convention; this does not publish a release.

## Command transition

The old `lithc compile` command emitted a dummy source-hash container. It was
replaced by the tested front end, which offers summary, AST, declaration ABI
and conservative declaration checks. `lithc 0.2.0` subsequently added the
fail-closed output modes documented in [EVM backend v1](EVM_BACKEND_V1.md).

```sh
cargo run -p lithc -- --emit check apps/examples/frontend/hello.lithic
cargo run -p lithc -- --emit ast apps/examples/frontend/hello.lithic
cargo run -p lithc -- --emit evm apps/examples/frontend/evm-constants.lithic
cargo run -p lithfmt -- --check apps/examples/frontend/hello.lithic
cargo run -p lithlint -- --deny-warnings apps/examples/frontend/hello.lithic
```

`check` does not type-check or execute function bodies. The EVM backend applies
its own strict body/type validation and rejects anything outside its documented
subset. Existing draft syntax such as LEP100-15 is not yet supported. Formatter
and linter retain their bounded whitespace/declaration behavior. Native VM
packages remain separate scaffolds.

## Next boundary

The first executable target uses the deployed EVM interface. Expanding it
requires typed body parsing, storage/call lowering and rollback tests. A
separate native LithoVM still requires bytecode/versioning, instruction, gas,
storage, call, rollback, deployment and host-interface specifications. The
public native VM scaffold does not execute contract instructions.
