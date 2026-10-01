# MultX native-liquidity vault remediation candidate

## Scope

`NativeLiquidityVault` implements native-asset settlement for Ethereum, BNB
Chain and Base. Source deposits remain native currency in escrow. Destination
payouts use separately funded native liquidity. DEX quoting and execution are
outside this vault.

## Settlement controls

- The source operation ID is derived on-chain from source chain, source vault,
  depositor, depositor nonce and client reference. Another depositor cannot
  reserve that operation ID by copying a client reference.
- Release authorization binds the complete source identity, transaction,
  amounts, recipient, release deadline and authorization expiry. Authorization
  cannot outlive the release deadline.
- After the release deadline, the destination can enter one terminal state:
  `Released` or `Cancelled`. A late release cannot follow cancellation.
- A source refund requires validator-attested cancellation transaction, block
  and finality evidence after the route-specific finality delay.
- The signer journal stores one terminal path commitment per canonical
  operation. `release` conflicts with `cancel/refund`; cancellation and its
  matching refund share the same durable commitment.
- Release, cancellation and refund evidence is checked before and after the
  journal write. A reorg after the first check withholds the signature while
  retaining the safe terminal decision.

Exactly five validators are configured and exactly three ordered signatures
are required. Source escrow is excluded from payout liquidity and governance
withdrawals. Deposit and payout volumes have separate finite daily caps. The
vault starts paused with no routes, zero caps, no guardian and no reserve.

The full transition rules and required evidence are specified in
`NATIVE_SETTLEMENT_PROTOCOL.md`.

## Verification controls

The preflight authenticates each RPC with an explicit `eth_chainId`, requires
the exact approved plan digest and chains 1/56/8453, and pins all reads to one
block whose hash is rechecked. It verifies approved runtime hashes for the
deterministic factory, Safe proxy, singleton and fallback handler, plus complete
module pagination. Local JSON-RPC integration tests cover the wrong chain,
reorganization, plan alteration and incomplete chain set.

The post-deployment verifier authenticates the two exact factory transactions,
Timelock and vault runtimes, Safe-to-Timelock roles, 48-hour delay, Timelock
ownership, 3-of-5 validator set, paused state, zero routes/caps/activity/reserve
and one stable block snapshot. It consumes a sanitized deployment record and
never broadcasts.

`NativeLiquidityVault` is included in the immutable bytecode evidence generator
with pinned compiler input/settings, creation/runtime identities and exact
source-to-commit checks.

## Deployment status

This is a remediation candidate only. MultX, release signing, relaying, Swap,
canary and activation remain disabled. A new Autha disposition and separate
paused-deployment authorization are required before any deployment.

## Validation

Run the complete contract and signer suites:

```text
cd MultX/contracts && npm test
cd ../signer && npm test
```
