# Lithic contracts in LithoScan and Makalu

Lithic contracts run through the LithoVM gateway. They have no Solidity bytecode
at their own address. The indexer stores `contracts.vm = 'lithovm'`; the API exposes
this as `runtime: 'lithic'` for contract and token pages. Token metadata discovery
and the UI use this marker for every native contract, independently of its symbol.

## Event positions for explorer and wallet consumers

Gateway event logs on mainnet currently contain `blockNumber: "0x0"`. Take the
height from the **transaction receipt's top-level `blockNumber`**, then obtain the
timestamp from the indexed block at that height. Do not use the event log's height
or assume height zero means genesis. `/api/txs/:hash/logs` exposes receipt-derived
`blockHeight` alongside each decoded log. Its `raw` receipt preserves upstream data.

One gateway log can contain multiple native events. Keep the existing synthetic
transfer positions in `lithovm.ts` when replaying receipts; changing that scheme
would duplicate transfers in existing explorer databases. Failed calls must not
create deployments or transfers. Gateway backfill begins at mainnet activation
block 14,946,527. Other networks can configure `LITHOVM_START_BLOCK` explicitly.

## Metadata and verification

Read native token metadata through the gateway with a nonzero `from` address.
Native selectors are full 32-byte hashes. `decimals()` returns `u64`; supply and
balances return `u256`. The indexer retrieves deployment bytecode, checks its hash
against the gateway deployment record, and reconstructs its typed interface.
When available, this interface must contain the complete LEP-100 function and
event signatures before the contract is identified as a token. This also avoids
presenting an ERC-20 ABI or an ERC-20 wallet action for a Lithic contract.

Token identity and source verification remain separate. Mainnet LAX at
`0x29147bebb1c49c3a54aa464137611fe708886df3` is the official contract supplied by
the project owner and receives the official token mark only on chain 9005.
That registry entry does not set the database's source-verification flag.
Other token marks continue to require the existing verification proofs.
Native contract addresses and creators are displayed in `litho1` format;
Solidity contracts retain their EVM aliases. Lithic token profiles say
`LEP-100 Lithic`.

## Receipt throughput and explorer lag

The prefetcher first attempts block receipts where supported. On the current
mainnet RPC that method is unavailable, but JSON-RPC receipt batches work.
Receipt batches contain at most 64 requests; responses are matched by ID and
validated against the requested transaction hash and block. Missing entries
fall back to bounded individual requests. Database writes and checkpoints remain
ordered. Native metadata discovery stays outside block-ingestion transactions.

Block preparation overlaps across up to four heights. The next block's RPC
reads can run while the current block commits, but database writes and both
checkpoints advance one height at a time. A failed read or write stops the range;
later prepared blocks cannot advance the cursor. `BLOCK_PREFETCH_CONCURRENCY`
defaults to 4 and is bounded to 1–4. A value of 1 reduces RPC pressure.

The sync banner distinguishes chain tip, indexed block and the block containing
the latest indexed transaction. Its approximate duration is blocks behind times
recent block duration. It describes the amount of chain history still to index,
not an estimated completion time or a claim that the chain has stalled.

## Token icons

The icon endpoint queries Degens' public `/v1/discover` search by the indexed
symbol and accepts an icon only after matching both contract address and chain
ID. HTTPS images load lazily with a letter fallback. Results are cached; an icon
service failure does not prevent token pages from loading or grant verification.

## Read-only validation

From `Makalu/indexer`, run `pnpm exec tsx scripts/check-lithic.ts`. It verifies the
real LAX deployment hash, typed interface, supply and receipt height and checks
RPC receipt capabilities. It sends no transactions. `LITHIC_CHECK_RPC` can select
another endpoint that serves mainnet history.

The live check on November 25, 2026 (Karachi time) confirmed deployment block
14,961,748, 18 decimals and 10,000,000,000 LAX. The original public explorer
reported seven holders and seven transfers. After correcting the detail query
to count positive balances, it reports six holders and seven transfers, matching
the token list. An initial summary was one block behind the chain.
These are observations, not fixed production values or a future throughput guarantee.

Protocol references: the supplied `lithic-integration-docs.zip` and the pinned
[LithoVM bytecode parser](https://github.com/KaJLabs/Lithosphere/blob/8725ce9a7a7147aa097c8a2cba21d3d102c3b412/lithic-toolchain/packages/vm/bytecode/src/lib.rs).
