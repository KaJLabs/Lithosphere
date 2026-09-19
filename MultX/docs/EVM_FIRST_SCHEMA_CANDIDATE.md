# EVM-first schema candidate

Superseded as the launch proposal by the client-confirmed native swap direction.
See [Native swap delivery plan](NATIVE_SWAP_DELIVERY_PLAN.md). Retained as
historical candidate documentation; its one-asset topology does not satisfy the
confirmed product scope. Existing review archives remain unchanged.

Unaccepted extension of source-accepted commit 465f6868555ba528d1d9417885a791ae573bbd5a.

Schema version 1 retains its accepted LITHO-origin topology. New version 2
requires rollout `evm-first`, numeric sourceChainId explicitly selected from
1, 56, 8453, and exactly those three chains. The source bridge escrows one
approved ERC-20 asset; destination bridges mint/burn its wrapped representations.
The plan requires exactly one asset to match this initial API profile.

The origin chain is NOT selected by the developer. Template variants demonstrate
all three choices and remain blocked placeholders; client asset and origin
approval is required. This profile deliberately does not support native ETH/BNB
deposits, independent native assets on several chains, liquidity routing, direct
destination-to-destination transfers, or automatic two-hop execution. It is a
bounded escrow/wrapped-token bridge profile, not the complete MultX swap layer.

Plan and manifest must agree on schema/origin under the approved-plan digest.
Bridge kind, constructor evidence, runtime identity, canonical/wrapped asset
identity and wrapped-token origin checks follow that approved origin. Native
LITHO precompile handling remains restricted to the original chain 9005 path.

The API requires environment `multx-evm-mainnet`, schemaVersion 2, rollout
`evm-first`, originTokenAddress, three watched/supported chains and exactly four
reciprocal routes for the one asset. It rejects missing reverse mappings,
destination-to-destination routes, legacy token field and extra chains. The
existing internal lithoTokenAddress alias holds the origin token only for
backward compatibility; no LITHO asset claim follows from the internal name.

Quorum 3-of-5, approved hashes, custody, governance, pause, finality and evidence
gates remain in force. All addresses, assets, liquidity and actual deployment
parameters remain unapproved placeholders until supplied. Review this schema
candidate separately; the previous source acceptance does not cover it.

Verification coverage includes the complete read-only verifier against deterministic
RPC doubles for each origin. No verifier or governance helper is replaced. These
tests exercise bridge creation, Safe/Timelock checks, token history, validators,
routes and wrapped-token identity through the public entry point. Negative cases
reject swapped source/destination creation bytecode, wrong wrapped origins and
extra destination routes. Targeted mutations test the origin allowlist, creation
selection, wrapped-origin guard and route-verification call site. API mutations
cover explicit origin, reciprocal token mapping and the exact route count.
This is simulated RPC coverage; a deployed-chain rehearsal remains outstanding.
