# Native LITHO verifier candidate

Review candidate only. This extends deployment tooling; bridge Solidity, the
accepted v0.9.2 tag and production configuration are unchanged. It is not an
Autha-accepted release or deployment approval.

## Identity selection

Ordinary assets retain the default `identityType: "runtime-bytecode"` and all
existing runtime hash and wrapped-token creation-provenance checks.

The approved plan's canonical LITHO asset may select
`identityType: "native-precompile"` only with origin chain 9005, origin token
`0xD4949664cD82660AaE99bEdc034a0deA8A0bd517`, name `Lithosphere`, symbol `LITHO`
and 18 decimals. It must include this separately reviewed policy:

```json
{
  "nativePrecompile": {
    "denom": "ulitho",
    "implementationSha256": "<approved node executable SHA256>",
    "evidenceSha256": "<SHA256 of exact checkpoint evidence file>",
    "securityApprovalUrl": "https://<independent security acceptance record>",
    "operatorApprovalUrl": "https://<operator acceptance record>"
  }
}
```

The source-chain manifest asset must explicitly match that identity type and
omit `runtimeSha256`. No native identity override is permitted on destination
assets. Wrapped representations still bind originToken to the same precompile
and originChainId to 9005, with ordinary code/creation checks. Unknown identity
types, native policy on ordinary assets and a native asset claiming a runtime
hash are rejected. Approval records and policy belong to the independently
supplied plan, not to the manifest's native asset.

## Independent evidence and trust boundary

Supply a raw JSON file using the additional CLI option
`--native-precompile-evidence /path/to/reviewed-checkpoint.json` alongside the
existing plan, manifest, bytecode-evidence and transaction-free confirmation.
Programmatic callers provide `approvedInputs.nativeEvidenceBytes` as a Buffer.

The evidence hash in the approved plan authenticates the exact file; approval
URLs are references, not cryptographic signatures or automatically fetched
approvals. Operators must authenticate the plan and review the evidence before
invoking the verifier. An attacker-controlled plan can invent approval URLs;
this tool is not a replacement for that external approval root.

The file must contain:

- `schemaVersion: 1`, `chainId: 9005`, `cosmosChainId: "lithosphere_9005-1"`,
  the exact precompile `address`, and the approved `nodeBinarySha256`;
- `verificationBlock` and `verificationBlockHash` from the EVM checkpoint;
- `moduleStateHeight` and `moduleStateBlockHash` identifying that same height
  and EVM block hash for the independently collected Cosmos module snapshot;
- `erc20Params` with `enable_erc20: true`, exactly this one native precompile,
  and an empty dynamic-precompile list;
- exactly one `tokenPairs` entry for that address, denomination `ulitho`,
  `enabled: true`, and `contract_owner: "OWNER_MODULE"`;
- `bankBalance` with the intended bridge `address`, `denom: "ulitho"` and
  `amount: "0"` at the checkpoint, preserving pristine deployment verification.

The snapshot is NOT a self-authenticating consensus proof. Collect implementation
identity from the running process, not merely a similarly named binary file.
Authenticate module and bank state through approved independent infrastructure;
an unpinned latest REST response is insufficient. Retain source records and
their review in the approval package. The verifier compares the independently
approved evidence against live EVM observations but does not remotely inspect
the running node binary or independently validate Cosmos Merkle proofs.

Native verification uses the evidence checkpoint, which must be within 32 blocks
of the current head and no older than 300 seconds (at most 5 seconds future clock
skew). The bounds are fixed; operators cannot disable them by editing a manifest.
If review/collection cannot meet this bound, do not bypass it: propose a reviewed
checkpoint workflow change. The final block hash is rechecked for reorganization.
Metadata, empty code and bridge native/ERC20 balances must agree with the snapshot.
Balances must be zero for this initial paused/pristine verification mode.

## Scope preserved

All four required chains, 5-of-7 signer policy, ordinary code checks, governance,
paused state, route universe, zero initial activity, positive deployment-plan
caps and independent bytecode evidence bindings remain in effect. No Solana
deployment or signing support is implemented by this EVM verifier change.

The local stateful compatibility package previously passed 27 scoped assertions
and one three-account Cosmos/EVM/ERC20 balance cross-check. It is supporting
evidence, not complete acceptance: maximum allowance/expiry, cap-window reset,
callback boundaries, per-transaction bank snapshots and indexer behavior still
require coverage. No real production plan or checkpoint evidence is fabricated
as part of this candidate.

## Validation and next gate

Tests cover native policy/evidence validation, exact plan/manifest binding,
ordinary-destination preservation, RPC and checkpoint failures, substituted
evidence, disabled/ambiguous token pairs, wrong metadata, balances and network.
The normal contract test suite also exercises existing bridge/governance gates.

Next: independent review of this tooling and its trust boundary, completion of
the remaining compatibility tests, approved rollout implementation identity and
operational acceptance. Deployment and activation require separate authorization.
