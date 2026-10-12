# LithoScan client fixes — 2026-10-12

Implemented in the working tree. Not committed, pushed, or deployed. Existing unrelated changes in this workspace were preserved.

## Changes

1. **Validator sorting:** PostgreSQL now sorts the VARCHAR stake and commission fields numerically. Stake ties have a deterministic address order. Fractional stake is preserved: the reported `validator1` holds `0.99 LITHO`, previously displayed as zero. The API hook also ignores late responses from previously selected sorts/filters.
2. **Homepage metrics:** Added a responsive LITHO market overview with price, total-supply valuation, actual bank supply, bonded voting power, and indexed TPS. Existing transaction totals, block timing, latest block, and gas metrics remain available. Removed the unsupported fixed gas-cost estimate. Total-supply valuation is explicitly distinguished from circulating market cap.
3. **Price integration:** Ignite's public market-data tickers are primary. A timestamp-checked Magma LITHO-USDT reference ticker is the fallback. Quote currencies are explicit; LAX pairs are not treated as USD. Missing, invalid, or stale prices remain unavailable. Polling is cached for 60 seconds; Magma reference quotes older than 15 minutes are rejected.
4. **Suggested searches:** Focus opens token, recent-address, validator, and page suggestions using indexed data. Supports filtering, keyboard selection, Escape, touch/click, DNNS resolution, and partial API failures. Suggestions are not represented as measured trending activity. The mobile menu closes after selection.
5. **Ignite navigation:** Replaced Sign In in the main navigation with an external Ignite DEX link, including the mobile menu.
6. **Precision:** Native amounts retain all significant fractional digits through 18 decimal places using integer arithmetic. Long values can wrap. Validator stake detail and list output also preserve fractions. Trailing zeroes are omitted; meaningful digits are never truncated.
7. **Memos:** The indexer reads `TxRaw.body_bytes -> TxBody.memo`, rather than looking for a nonexistent event attribute. Re-indexing a transaction updates its memo. Older empty indexed memos are recovered for transaction-detail REST responses from the matching chain LCD, with a bounded cache. Lookup failure is visibly distinct from an empty memo. Historical database rows/GraphQL responses are not bulk-backfilled by this change.

## Live evidence

- Transaction `85D2021E9996402CB31F04B6953753F91B8BDC28AF3B6C25168E7FFEE1F1C378` has signed memo `123456`, confirmed through both mainnet LCD and raw CometBFT transaction bytes. The live explorer returned an empty memo before deployment of these fixes.
- The existing live highest-voting-power response placed `990000000000000000` base units ahead of `8000300000000000000000000`, consistent with text sorting.
- Ignite's live ticker feed did not contain LITHO during verification. Magma's LITHO-USDT ticker returned `8.7` with timestamp `1791368470729` and an empty executed-trades feed. The timestamp is stale; it is not published as a current price by the new adapter.
- The compiled recovery helper retrieved `123456` from the real mainnet LCD. The supply adapter returned `999999999989999972424831010` base units; this value changes as chain supply changes.

Provider references: [Ignite market-data API](https://ignite.trade/api-docs), [Magma endpoints](https://magmadex.trade/docs#doc-endpoints).

## Verification

- Explorer: 144 tests passed.
- API: 178 tests passed; 9 database integration tests skipped because a local PostgreSQL/Docker server is unavailable.
- Indexer: 51 tests passed, including original signed transaction bytes, Unicode/whitespace memos, repeated protobuf fields, and malformed rejected transactions.
- API and indexer TypeScript builds passed.
- Explorer production compilation, type validation, and page generation passed. Windows standalone tracing reported an EPERM symlink-copy warning for ethers. Do not use this local standalone directory as a deployment artifact; rebuild the image in the existing Linux build workflow.
- OpenAPI route check passed: 39 endpoints, including `/market-summary`.
- Playwright Chromium checks passed at 390px mobile and 1440px desktop: suggestions, menu link, memo, fractional values, homepage quote/valuation, light/dark dropdown visibility, viewport overflow, and browser exceptions. These UI checks used deterministic API fixtures, not a deployed backend. Fixture screenshots under `.inspection/client-fixes-*` are validation artifacts, not live price evidence.
- `git diff --check` passed.

## Release scope

Release the API, indexer, and explorer together through the existing isolated LithoScan mainnet pipeline. No chain transaction, consensus configuration, token precision, or DNS change is required. The backend must use the matching mainnet LCD via `REST_URL`/`LCD_URL` or the mainnet default.

After deployment, verify the reported transaction shows memo `123456`, validator voting-power order is descending, `validator1` shows `0.99 LITHO`, and the mobile Ignite/search controls work. A current price remains dependent on fresh provider data; unavailable is the expected state for the observed feeds.
