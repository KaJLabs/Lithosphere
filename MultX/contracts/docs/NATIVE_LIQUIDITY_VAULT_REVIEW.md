# MultX native-liquidity vault review candidate

## Scope

`NativeLiquidityVault` implements the initial native-asset settlement primitive
for Ethereum, BNB Chain and Base. Each chain receives the same deterministic
contract address. Source deposits remain native currency in escrow; destination
payouts use separately funded native liquidity.

DEX quote discovery and execution are outside this contract. The signed payout
amount is the settlement result supplied to the vault.

## Security model

- Exactly five bridge validators are configured and exactly three ordered,
  distinct validator signatures authorize a release, finalization or refund.
- Every signature is bound to the action, chain ID and vault address.
- Release signatures also bind the configured source chain, source vault,
  source transaction, input amount, recipient, output amount and expiry.
- Operation identifiers and source deposits cannot be processed twice.
- Source escrow is excluded from destination payout liquidity and governance
  withdrawals.
- Deposit and payout volumes have separate finite 24-hour caps.
- The vault starts paused with no routes, zero caps and no funded reserve.
- Configuration and unpausing require the 48-hour Timelock owner. The pause
  guardian may halt operations immediately but cannot resume them.

## Recovery behavior

Finalization converts a paid source deposit from escrow to free liquidity.
Refund requires an expired quote and a fresh 3-of-5 authorization. Finalization
and refund are mutually exclusive. Both remain available while the vault is
paused so an incident halt does not trap pending source escrow.

## Deployment controls

The deterministic plan builder refuses to produce a plan unless the production
inputs are marked `READY_FOR_REVIEW` and contain no known unavailable address.
The generated plan is review-only, sends zero value, deploys only the Timelock
and vault, and leaves every route and cap disabled.

The independent plan validator reproduces the reviewed bytes and enforces the
disabled state. The RPC preflight verifies chain identity, Safe policy,
deterministic factory, DEX dependencies and vacant expected contract addresses.
Neither script accepts a private key or broadcasts a transaction.

## Current blocking condition

The recorded `0x4E7d740Af889EADcC902F9304315677E479aB3b6` key is unavailable but remains
assigned as a Safe owner, bridge signer and fee payer. The plan builder is
therefore deliberately blocked until those assignments and their evidence are
replaced. No deployment, canary or activation is part of this candidate.

## Validation

From `MultX/contracts`:

```text
npm test
```

Expected result for this candidate: 195 passing tests.
