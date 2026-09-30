# Autha native-mesh remediation map

This candidate addresses the source and verification findings in
`AUTHA_NATIVE_MESH_REVIEW_2026-09-30.md`. It does not authorize deployment,
signing, relaying, canary or activation.

| Finding | Candidate closure | Validation |
|---|---|---|
| NM-H01 | Destination `Released`/`Cancelled` terminal state; release deadline bounded by source quote; finalized cancellation evidence and fixed per-deposit finality delay before refund; persistent signer terminal-path commitment | `NativeLiquidityVault.test.js`, `nativeSettlementPolicy.test.js` |
| NM-M01 | Explicit `eth_chainId`; exact plan digest and exact chain set; every read pinned to one block/hash; hash recheck | `NativeMeshPreflight.test.js` uses local HTTP JSON-RPC endpoints for PASS, wrong-chain, reorg and plan/chain-set negatives |
| NM-M02 | Factory, Safe proxy, singleton and fallback runtime hashes; complete module termination; native post-deployment provenance/state verifier | `preflight-paused-deployment.cjs`, `verify-paused-deployment.cjs` |
| NM-M03 | On-chain operation ID derived from chain, vault, depositor, nonce and client reference; complete identity used for destination replay state | `NativeLiquidityVault.test.js`, `nativeSettlementPolicy.test.js` |
| September 9 H-01 | LITHO verification now requires the independently supplied checkpoint to equal the latest observed block; all verification reads use that latest block | `NativePrecompileVerifier.test.js` |
| Release evidence | `NativeLiquidityVault` included in pinned compiler-input and bytecode evidence generator; exact source/commit comparison retained | `BytecodeSourceIdentity.test.js` |

The assignment delta, custody evidence, route/finality acceptance and any
paused-deployment window remain independent operational inputs. Autha must
review this candidate and issue a new disposition before the plan status can be
changed to `READY_FOR_REVIEW`.
