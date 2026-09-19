# Verified V2 route quotes

quoteV2Routes(provider, registry, input) evaluates up to 20 direct ERC-20 V2 paths
from an operator-managed venue registry. Input selects tokenIn, tokenOut, amountIn
as a base-unit string and slippageBps. It does not accept router calldata or pool
addresses from a user's quote. Unique venue IDs identify separate candidates.

Each route requires enabled/current approval, chain/token identities, reviewed
standard-token semantics, router/factory/pair/token runtime hashes, an approved
fixed fee ratio, and maximum price-impact/slippage bounds. Reads use one canonical
block: router factory, factory pair lookup, pair token order/reserves, actual pool
token balances and router getAmountsOut. The returned amount must independently
match the reserve/fee formula. Empty pools, reserve deficits, code/identity drift,
expired approval, excessive price impact and inconsistent quotes exclude that
venue. A final block-hash mismatch rejects the complete batch.

Quotes include venue, chain, router/pair/path, input/output/minimum amounts,
block number/hash and a short expiry capped by approval expiry. They are ranked by
gross output for the same input/token pair; gas cost is not included in ranking.
Every quote has executable:false. This module does not reserve liquidity, publish
an API route, create swap intents, approve spending or submit a DEX transaction.

Only fixed-fee constant-product V2 direct paths are supported. No deployment or
compatibility is inferred from a DEX brand name. V3/concentrated-liquidity pools,
multi-hop routing, dynamic fees, Solana/Raydium and native assets need separate
adapters. Native wrapping remains an explicit source step. Contract bytecode pins
alone do not establish proxy implementation safety or token backing; registry
approval must establish these conditions before enabling a venue.

Five targeted tests pass using synthetic ABI-encoded RPC responses: canonical
quote/minimum accounting, rejecting a bad venue while retaining another, policy
and runtime failures, reorg rejection, and ranking two separately verified pools.
Actual local DEX execution and cross-chain route integration remain outstanding.
No production pools, liquidity or routes were added or enabled.

## Local DEX execution candidate

prepareV2Swap requotes one approved venue, retains the greater of the original
user minimum and the refreshed slippage minimum, and refuses a quote below the
original minimum. It checks sender input balance and prepares an exact approval
when allowance is insufficient, plus swapExactTokensForTokens with an explicit
recipient and short deadline. The return value is unsigned; it does not broadcast,
reserve liquidity or mark a cross-chain swap complete. Wallet integration must
preserve the original minimum and check receipts/recovery between approval and
execution. Quote expiry and minimum output are enforced by the router call.

Six targeted tests passed, including execution against actual locally compiled
LithoswapV2Factory/Router/Pair contracts. The test compiles the checked-out Makalu
DEX sources with Solidity 0.8.24, deploys only to loopback Hardhat, seeds a pool
with 1000000/2000000 fixture units, verifies the quote, and swaps 1000 units for
1992 units to the specified recipient. It verifies exact input debit, recipient
credit and consumed exact allowance. An unavailable original minimum is rejected,
an excessive on-chain minimum reverts, and an expired deadline reverts.

Opt-in test: MULTX_LOCAL_DEX_TEST=1 and MULTX_LOCAL_SOLC pointing to the local
Solidity 0.8.24 executable, then run test/v2RouteExecution.integration.test.js with
the destination Hardhat fixture on port 18546. The local config permits equal
block timestamps for rapid deterministic deployments. No production config changed.
The test uses MockERC20 assets, not production liquidity or deployed mainnet DEXs.

Still required: attach the DEX leg to durable cross-chain swap intents and recovery,
verify supported production venues/token semantics and deploy/fund approved routes.
V3, multi-hop, Solana and Bitcoin remain outside this direct V2 adapter. No quote
or execution route is published or activated by this work.

## Durable destination DEX leg

Migration 017 stores one immutable DEX plan per swap, its signed transaction hash
and nonce, and verified output evidence. Optional destinationDex policy binds the
venue, minimum output, slippage and confirmations to the existing route policy.
Preparation uses the bridge settlement holder and amount; output goes to the
configured payout sender. Signed binding checks every execution field and refuses
replacement hashes. Approval remains a separate wallet action.

verifyNativeDexExecution checks the assigned successful transaction, exact call,
canonical receipt block, finality and historical output-token credit to the payout
sender before recording evidence. Replay returns the stored proof. Revocation
blocks new preparation/binding but does not hide a transaction that already mined.
Payout preparation, binding and submission require this evidence when destinationDex
is configured. Preparation/submission also recheck its block hash and confirmation
depth, so stale canonical evidence cannot authorize a payout.

The full two-chain rehearsal now includes a real destination V2 swap. It verifies
that payout preparation fails before DEX output is recorded, binding is idempotent,
insufficient DEX finality is rejected, the output minimum is credited and a changed
DEX block hash blocks payout. Valid evidence then permits the existing coordinator
and receipt worker to finish the native payout. Source authentication, source
reconnect recovery, quorum release and payout verification remain in the test.

The native payout remains pre-funded from an explicit fixed-payout commitment;
the DEX output is treasury ERC-20 inventory. This does not implement unwrap-based
native funding or make the DEX price determine the user's native payout amount.
The local settlement holder owns the released tokens and signs the DEX transaction.
Production custody/approvals, automated DEX submission/reconciliation, expired-plan
recovery, browser integration and funded production routes remain required.
No production migration, deployment, signing or activation was performed.

The expanded cross-chain test now needs MULTX_LOCAL_SOLC (Solidity 0.8.24) in
addition to the previously documented SDK build, PostgreSQL and two local nodes.
Destination confirmation blocks use zero timestamp increments in the disposable
fixture to avoid manufacturing future-dated quote evidence.

## DEX submission and receipt automation

submitBoundNativeDexExecution binds the externally signed bytes before attempting
broadcast. Under the swap lock it rechecks active policy and chain, then looks up
the bound hash. A known hash returns submitted without another broadcast. An
unknown hash requires fresh source and destination settlement evidence, a verified
venue quote meeting the original minimum, unchanged nonce, sufficient token
balance/allowance, native gas funds, adequate signed gas and unexpired policy/quote.
Broadcast response errors return uncertain because acceptance may already have
occurred. Retry uses identical bytes; there is no nonce/fee replacement or silent
replanning. Custody must retain and resupply those bytes across restart.

reconcileNativeDexBatch discovers bound, unverified DEX transactions from durable
records even when the broadcast response was lost. It advances past unverified
receipts and missing providers and records DEX evidence only through the existing
canonical receipt/output-credit verifier. Run the receipt worker with --with-dex
(and optionally --once) to reconcile DEX legs before native payouts. Migration 017
must already exist in that configured database. The worker never signs or broadcasts.
Its existing configured RPC timeout applies to the provider; callers of internal
services must also bound RPC operations. No production worker was enabled.

The expanded local two-chain test injects loss of the DEX broadcast response,
retries by the original hash and asserts one broadcast, rejects premature receipt
verification, reconnects PostgreSQL, records DEX evidence through the batch worker,
and confirms subsequent scans exclude it before completing native payout.
Expired quote/approval, changed nonce and failing receipts remain explicit recovery
cases; they do not trigger replacement execution or automatic refunds. Custody
worker wiring and an approved recovery procedure for these cases remain necessary.
