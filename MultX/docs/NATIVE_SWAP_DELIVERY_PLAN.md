# MultX native swap delivery plan

For current implementation and remaining work, see
[NATIVE_SWAP_COMPLETION_CHECKLIST.md](NATIVE_SWAP_COMPLETION_CHECKLIST.md).
The sequence below records the original plan; individual progress notes may lag.

Status: client-confirmed product direction; implementation design and production
deployment remain unapproved. Recorded 2026-09-12 from the client's conversation.

## Confirmed outcome

Users exchange a native asset on one chain for a different native asset on another.
Priority examples are ETH on Ethereum to native LITHO on chain 9005, BNB on chain
56 to native LITHO, and both reverse directions. ETH on Base is a distinct chain
asset and needs its own route evidence. Supporting Cosmos EVM networks is the
broader objective; each network still needs an explicit registry entry, tested
adapter and funded route before it can be advertised as supported.

The previous one-origin ERC-20/wrapped-token proposal is superseded as the launch
plan. Its tests remain useful bridge-verification evidence, but do not establish
native swap support. Do not ask the client to select one origin asset again.
Destination native output is required. Internal wrapping may be an implementation
step if reviewed; handing the user a wrapped token is not a completed native swap.

Solana and Bitcoin remain later delivery work. This confirmation restores LITHO
to the priority swap path despite the earlier ETH/BNB/Base-first bridge sequence.
It does not assert that LITHO governance, deployments or liquidity are ready.

## Existing work and gaps

The source-accepted bridge baseline is commit
465f6868555ba528d1d9417885a791ae573bbd5a. It supplies escrow/mint/burn settlement
primitives, 3-of-5 bridge validation and governance verification, not a complete
native swap executor. The schema/verifier extension at
9d62ad189e960d97332773176f288e24d66fe8e2 is unaccepted and retains a topology too
narrow for the confirmed product. Neither acceptance nor test counts imply live
native swaps.

The earlier routing package contains an offline evaluator and a read-only V3
observation adapter. It does not establish funded mainnet routes or executable
quotes. Existing native-precompile work is compatibility evidence; native receipt
and accounting must still be demonstrated in the final swap path.

## Proposed route to evaluate first

For ETH to LITHO, evaluate native ETH input -> reviewed native-input adapter ->
verified venue swap into a backed LITHO representation on Ethereum -> bridge
redemption on LITHO -> independently verified native LITHO received by the user.
For the reverse direction, evaluate native LITHO escrow -> backed representation
on Ethereum -> venue swap -> native ETH delivery. Evaluate the analogous BNB route.

These are conditional designs, not available routes. They require backed token
representations, real executable liquidity, verified contracts and native receipt
semantics. If these prerequisites cannot be demonstrated, report the route as
unavailable and evaluate a separately reviewed liquidity-provider settlement
design. Do not silently substitute an unfunded pool or promise atomic rollback.
No choice of internal settlement asset is approved by this document.

The quote must identify input/output chain and native asset, exact input, minimum
native output, recipient, expiry, route steps, all fees and recovery terms.
Destination prices can change during cross-chain settlement. A minimum output
must either be enforceable through a reviewed reservation/fill mechanism or leave
the transfer recoverable pending an acceptable destination quote. Never mark a
swap successful because the bridge leg alone completed.

## Delivery sequence and ownership

| Step | BrewCodeDev deliverable | Completion evidence / dependency |
| --- | --- | --- |
| 1 | Specify native asset identities, route steps, quote fields and recovery states; build an offline route-policy validator | Fixtures for ETH/BNB to LITHO and back; reject missing liquidity evidence, wrong chain/asset, expired quotes and wrapped final output |
| 2 | Verify candidate venue and settlement routes with read-only adapters | Amir/client provide or confirm token, router, pool and settlement deployments; record block/hash, provenance, executable amounts and backing |
| 3 | Implement native input/output and swap execution adapters on disposable networks | Demonstrate balances, fees, slippage, recipient checks and LITHO precompile behavior with the intended runtime; no arbitrary quote-provided call targets |
| 4 | Add durable cross-chain coordination and SDK quote/status contracts | Restart, duplicate event, reorg, timeout and partial-failure tests; report completion only after independently verified final native payout |
| 5 | Assemble candidate for Autha and operator review | Exact source/build evidence, threat model, end-to-end rehearsal, custody and governance decisions |
| 6 | Prepare paused deployment, verification and canary | Client/governance deployment authorization and activation approval; actual deployment evidence before enabling any route |

Step 1 now has an offline validator and synthetic route-policy tests; see
[Native route policy](NATIVE_ROUTE_POLICY.md) for its input contract and limits.
Recovery declarations are checked, but the durable state machine remains step 4.
Live contract addresses were not needed for these synthetic tests. Steps 2 onward must not infer missing deployment
records or use historical testnet addresses as mainnet configuration.

## Recovery and acceptance requirements

Persist source submission/finality, settlement pending/confirmed, destination
execution pending and native payout confirmed as separate states. Use chain and
transaction/event identities for idempotency. After any irreversible step, retain
the actual asset/location and authorized claimant. Refund only when the relevant
escrow permits it and proof excludes an already completed payout; a timeout alone
must not authorize both refund and later settlement.

For every enabled direction, test native input and output accounting, failed
recipient transfers, fee-on-transfer/rebasing asset rejection unless supported,
quote expiry, slippage, insufficient liquidity, source reorg, bridge pause,
destination swap failure, retry after restart and prevention of double payout.
Test the selected native LITHO representation against the production-matching
runtime, including native-balance effects, not just an ERC-20 Transfer event.

Keep the approved 48-hour governance delay and 3-of-5 bridge direction. Remaining
inputs include named custody/operators, LITHO/Base governance, deployer, fee payer,
pause guardian, funded liquidity amounts, per-route exposure and finality policy.
Earlier requests for unlimited caps and 2–3 confirmations are not sufficient
evidence that those settings suit every native swap path.

No production quote, execution endpoint or route is declared live by this plan.
MultX remains disabled pending reviewed implementation and deployment evidence.
