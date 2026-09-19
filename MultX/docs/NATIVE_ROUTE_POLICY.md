# Offline native route-policy validator

`api/src/services/nativeRoutePolicy.js` exports
`validateNativeRouteProposal(quote, policy, now)` for offline design checks.
It is not imported by the running API and exposes no quote or execution endpoint.

Run synthetic scenarios from `MultX/api`:

```sh
node --test test/nativeRoutePolicy.test.js
```

The fixtures model ETH/BNB to LITHO and both reverse directions with invented
contracts, amounts and evidence references. A modeled wrap/native-release step
does not establish the correct LITHO precompile implementation. These fixtures
must not become deployment configuration.

## Input contract

Policy schemaVersion 1 requires mode `offline-design`, bounded evidence/quote
lifetimes, an asset registry and an edge registry. Asset IDs are local references;
identity is chain ID plus native kind or exact ERC-20 address, never a symbol.
Decimals are registry metadata. Base-unit amounts are canonical uint256 decimal
strings and are never converted through JavaScript floating-point numbers.

Edges declare exact input/output asset IDs, kind and input capacity. Kinds are
wrap, swap, bridge, unwrap and native-release. Only bridge edges cross chains;
native input/output use explicit adapter steps. Each selected edge requires dated
evidence with its reference, exact quoted input/minimum output and deployment
reference. Swap steps also need liquidity references, bridge steps backing and
finality references, and native steps native-accounting references. Evidence
references are opaque caller-supplied identifiers, not fetched or authenticated.

Quotes declare native endpoints, recipient, amount, creation/expiry times, ordered
edge references and a final native minimum. Each step consumes exactly the previous
step's conservative minimum, and its amounts must match its evidence record.
There is exactly one bridge edge in this first model; multihop settlement is not
implemented. Unknown step properties, including calldata, are rejected.

Fees explicitly identify source gas, destination gas, bridge and protocol estimates,
including zero fees. Gas is separately paid in the relevant chain's native asset.
Other fees declare separate payment or inclusion in step minimums. The validator
checks declarations, not economic accuracy, actual gas affordability, payer funding
or fee collection. All estimates need verification by future adapters.

Only a non-atomic `recoverable-requote` execution design is modeled. The recovery
claimant must match the recipient, recovery terms must be referenced and automatic
timeout refunds are forbidden. This validates recovery declarations; it does not
implement a state machine, refund entitlement, persistence or payout verification.

## Meaning of success

Success returns `offline-design-valid`, `executable:false` and
`evidenceAuthenticated:false`. The final minimum is a structurally checked proposal,
not a guaranteed cross-chain fill. A future executor must obtain an acceptable
destination quote after settlement or preserve a recoverable position; it cannot
declare success from bridge completion alone.

Next work is an evidence ingestion boundary binding independently verified venue,
deployment, backing, capacity and native-accounting observations to these policy
records. Actual execution still requires reviewed adapters, native-payout checks,
durable recovery, security review and deployment authorization. This module must
not be promoted to a production authorization gate merely by changing `mode`.
