# Lithic EVM backend v1

Status: preview release candidate

Target: `evm-lithosphere-9005-v1`

`lithc 0.2.0` can produce an ABI, deployment bytecode and runtime bytecode for
a strict stateless Lithic subset that executes through the EVM interface
available on LITHO mainnet chain 9005.

## Compile

```sh
cargo run --locked -p lithc -- \
  --emit evm apps/examples/frontend/evm-constants.lithic \
  > ReleaseInfo.json
```

Other output modes:

```sh
lithc --emit bytecode Contract.lithic  # constructor/deployment bytecode
lithc --emit runtime Contract.lithic   # deployed runtime bytecode
```

The JSON artifact contains the target identifier, EVM ABI, deployment
bytecode, runtime bytecode, canonical signatures and four-byte selectors.

## Supported source

Every compiled function must be:

- `pub` and synchronous;
- use only static `u64`, `u256`, `bool`, `address`, or `bytes32` parameters;
- explicitly return `u64`, `u256`, `bool`, `address`, or `bytes32`;
- contain exactly one return statement whose value is a constant or a
  same-typed parameter.

Example:

```lithic
contract ReleaseInfo {
    pub fn litho_chain_id() -> u64 {
        return 9005;
    }
}

contract Identity {
    pub fn echo(value: u64) -> u64 {
        return value;
    }
}
```

The backend supports multiple functions and standard EVM selector dispatch.
Unknown selectors, wrong calldata lengths, and non-canonical `u64`, `bool`, or
`address` encodings revert.

## Fail-closed rules

The complete compilation fails when source includes any unsupported semantic,
including state fields, constants, private functions, dynamic parameters,
async functions, attributes, expressions, calls, or unsupported types. It never
emits partial bytecode after dropping source behavior.

This release does not yet support storage, external calls, transfers, events,
constructor arguments, payable functions or LEP100-15. Those features require
the typed statement/expression IR and corresponding execution tests.

## Verification

The test suite checks deterministic artifacts, selector generation, type and
literal bounds, unsupported-source rejection, constructor output, runtime
dispatch and ABI-encoded return values. Deployment and runtime bytecode execute
under the independent `revm` EVM implementation.

No production deployment is performed by the compiler. Signing and deployment
remain explicit external operations.
