# LithoScan rollout — November 25, 2026

The initial rollout put the API and frontends on
`df0b7da89d521751b59aa5a104510b5aefdb1773` and both indexers on
`adfc9f35270ab3c01818925752fb69c7bfe93876`. The November 25 follow-up below
records the later logo, alignment and maintenance corrections.

## Delivered behavior

- Unclaimed tokens keep the warning below their profile and have no Unverified
  badge. Verified tokens use the small outlined green verification seal.
- Native coin amounts display coin icons across transaction and validator views.
  Degens token icons require an exact contract and chain match.
- Gas price rounds upward to three significant digits: `8035714285` wei displays
  as `0.000000804 Mafic/gas`.
- Generic Lithic LEP-100 discovery, receipt-derived event heights, typed native
  interfaces and supply refresh apply to native contracts beyond LAX.
- Native profiles use `litho1` addresses and `LEP-100 Lithic`; Solidity profiles
  retain their existing address aliases and type.
- LAX's official identity mark is distinct from source-code verification. Its
  native interface has 33 entries, deployment block 14,961,748, six positive
  holders and seven transfers at validation time.
- Sync copy distinguishes the indexed block from the block containing the latest
  transaction. Duration represents chain history behind, rather than a recovery ETA.

## Indexer diagnosis and correction

On the configured mainnet endpoint, a busy block's transaction fetch took 259 ms
and its 18-receipt batch took 1,589 ms. The public RPC was slower for the same
block, so the existing endpoint was retained. Processing blocks sequentially
could fall behind the roughly 1.19-second block interval.

The indexer now prepares up to four blocks concurrently and commits them in
height order. A failed height stops checkpoint advancement. Receipt batches
remain bounded to 64 requests, and native discovery runs outside ingestion
transactions. Both hosts explicitly use `BLOCK_PREFETCH_CONCURRENCY=4`.

After restart, mainnet indexed 32 busy blocks between 22:38:34 and 22:38:53 UTC.
Its backlog fell from 85 to seven blocks by approximately 22:40 UTC and reached
zero by 22:41 UTC. Subsequent samples stayed close to the chain tip:

| Observation time (UTC, November 24) | Mainnet lag (blocks) | Makalu lag (blocks) |
| --- | ---: | ---: |
| 22:41:11 | 0 | 0 |
| 22:41:43 | 2 | 0 |
| 22:42:29 | 1 | 0 |

The latest 300 blocks on each network had no missing heights or transaction-count
mismatches. These samples confirm recovery under the observed traffic; they do
not establish a maximum transaction rate for future loads.

## Validation

- Explorer and API tests passed before deployment; the final indexer suite passed
  101 tests and TypeScript compilation.
- The frontend production build passed on Linux.
- Private candidates and the public sites passed real browser checks at 390 and
  1440 pixels, including canonical native token URLs, warning and verification
  behavior, logo loading, gas formatting, JavaScript errors and page overflow.
- Both networks' API, indexer and frontend containers were healthy with the
  expected image revisions. Network identity remained 9005 for mainnet and
  700777 for Makalu.
- LAX's missing native interface metadata was queued once for hydration. Its
  source-verification flag remains false; the official identity mark does not
  change that flag.

## Build provenance and pinned images

Builds:

- [Mainnet API, indexer and frontend](https://github.com/KaJLabs/Lithosphere/actions/runs/45498780815)
- [Makalu frontend](https://github.com/KaJLabs/Lithosphere/actions/runs/45498788442)
- [Final indexer](https://github.com/KaJLabs/Lithosphere/actions/runs/45502255128)

| Service | Image pinned on the host |
| --- | --- |
| Both APIs | `ghcr.io/kajlabs/lithoscan-api@sha256:b0c71f5ad9e10234b76777ba7a61de5768eba140afc2e239cfae12ad8a984919` |
| Both indexers | `ghcr.io/kajlabs/lithosphere-indexer@sha256:7a37ddf2bfe9a584558162cb26148de4c63ff7eb9694acd3ee94b09e01f42aa3` |
| Mainnet frontend | `ghcr.io/kajlabs/lithoscan-explorer@sha256:a7361357513aae229748587424cedfc0b96a73af17d7302bd66ae1c8fe238b14` |
| Makalu frontend | `ghcr.io/kajlabs/lithosphere-explorer@sha256:32dfd7a341d78170dca001b154e963dc98c15aed41b4d68015808bfef55b622d` |

## Operations and rollback

Host release records retain image identities, compose hashes and backups:

- Mainnet: `/opt/lithoscan-mainnet/releases/ui-lithic-20261125/`
  and `/opt/lithoscan-mainnet/releases/ui-lithic-prefetch-20261125/`.
- Makalu: `/opt/lithoscan/releases/ui-lithic-20261125/`
  and `/opt/lithoscan/releases/ui-lithic-prefetch-20261125/`.

Each directory contains `compose.before.yaml`, `compose.candidate.yaml` and
`release.json`. The first release preserves the pre-rollout configuration; the
second preserves the configuration before the indexer-only performance update.
Restore only the intended services after checking current compose and image
identities against the release record. The indexer-only restore must not replace
the deployed API or frontend. Database and Redis containers, volumes, existing
Makalu mounts and startup commands were preserved; `FORCE_REINDEX=0` remains set.

Temporary candidate containers, their isolated networks and SSH forwarding
processes were removed after validation. No blockchain transactions were sent.
Release commits use `bachal-mb`; commits are unsigned because the configured
signing key is unavailable in this workspace.

## November 25 follow-up: periodic lag, artwork and alignment

At 13:53 UTC the APIs and frontends on both networks were updated to
`3f271d528d83a6673582af4f83104ef2972373ce`. The indexer maintenance correction
was activated with that release. The durable repair safeguard and transfer
burst correction are in indexer `9d7162ee5bae65196436f841a0f54127a54968b5`.
That final indexer was activated on Makalu at 14:14 UTC and Mainnet at
14:15 UTC, preserving both audit cursors and the deployed API/frontends.

The previous prefetch correction improved throughput, but ingestion still
awaited statistics and whole-history consistency repair every five minutes.
The consistency query grouped the entire transaction history before applying
its output LIMIT. A small repair batch therefore did not bound the read cost.
Both tasks shared ingestion's five database connections.

Captured production logs showed recurring 16–24 second gaps between completed
blocks and the next ingestion cycle, at roughly five-minute intervals. One
database sample found an integrity scan waiting on DataFileRead after fourteen
seconds. The captured lag peak was 46 blocks. Block reads also had longer
pauses, and the consensus RPC returned 119 retryable HTTP 500 responses over
two hours, mostly for block_results at the chain tip. These observations do
not establish that every larger pause had the same cause; phase timings now
distinguish RPC preparation from database commits.

Maintenance now runs as separate single-flight jobs. Historical statistics
and audit reads use a dedicated one-connection pool, a ten-second statement
deadline and no parallel query workers. A slow job cannot borrow ingestion's
control flow or exhaust its connection pool. The latest block snapshot uses
an indexed descending-height lookup instead of a combined aggregate.

Every ten seconds the integrity auditor checks the latest 2,048 committed
blocks and a 10,000-block historical window. The historical cursor, captured
tip and partial count survive restarts. A full historical count remains
unknown until a sweep completes; the Prometheus gauge emits NaN in the
interim. This is a rolling audit, so a complete sweep takes hours on these
networks. Recent blocks are checked independently on every pass.

Detected repairs are persisted before the audit cursor advances. At most four
blocks are prepared with read-only RPC work at once. The ingestion loop alone
commits those prepared repairs, one at a time, without moving its live
checkpoint. Remaining repairs are drained before the next historical window,
including after a restart.

New metrics expose the last maintenance duration by task and histograms of RPC
preparation and ordered commit duration:

- `litho_indexer_maintenance_duration_seconds{task}`
- `litho_indexer_phase_duration_seconds{phase="rpc"|"commit"}`

Slow RPC preparations and maintenance failures carry phase/task and duration
in logs. Existing chain identity checks, receipt completeness checks and
ordered checkpoints remain in place.

The first eleven-minute observation after isolating maintenance still reached
30 blocks of lag during a transfer burst. The new phase timing identified
block 15,309,451 taking 30.306 seconds in RPC preparation. This block contains
231 transfers; one 64-receipt batch took 4.489 seconds. The RPC backend's
receipt path repeatedly fetches the block and execution results per
transaction, so increasing prefetch alone leaves substantial amplification.

For successful empty-input transfers, the finalized execution events already
include gas used and an explicit empty tx_log event. The indexer matches these
against full EVM block metadata and handles only the unambiguous 21,000-gas,
non-deployment case. All contract calls, deployments, failed executions,
nonempty logs, legacy event encodings and unknown shapes retain receipt RPC.
This follows the upstream
[execution event emission](https://github.com/evmos/evmos/blob/v20.0.0/x/evm/keeper/msg_server.go#L73)
and [receipt construction](https://github.com/evmos/evmos/blob/v20.0.0/rpc/backend/tx_info.go#L129).

A read-only differential replay of that real 231-transfer block took 806 ms
with the new path and 15,952 ms with the prior path. All 231 consumed receipt
records matched in destination, value, gas used, effective gas price, status,
contract address and logs. The new path needed one EVM block read; the old
path also probed block receipts and sent four receipt batches. No chain
transactions or production database writes were performed by the replay.
Calling the deployed image's actual `prepareBlock(15309451)` subsequently
took 742 ms with all 231 transaction details present, using only a block read,
a block-results read and a full EVM-block read.
A transfer persisted by the final build at block 15,310,415 was also compared
with its chain transaction and receipt: value, gas price, gas used and success
status all matched.

After restart catch-up, an eleven-minute observation of the final build made
85 summary requests per network. Mainnet stayed 0–2 blocks behind and Makalu
0–1, with no failed requests or syncing warnings. The observation covered the
five- and ten-minute statistics cycles and the ten-minute validator refresh.
The Mainnet indexer logged no maintenance failures, cycle failures or RPC
preparation warnings above five seconds. Its log peak of eight blocks occurred
during restart catch-up before that observation. The warning threshold remains
30 blocks; no warning was hidden or relaxed.

This removes the two measured bottlenecks. The observation is bounded: RPC
outages, sustained workloads beyond database capacity or other infrastructure
failures can still create lag. The phase metrics and slow-operation logs
remain available to distinguish those causes.

The LAX image is bundled from
[Ignite's LAX artwork](https://ignite.trade/tokens/lax.png). Its SHA-256 is
`188e9ef1adbc8e2c33502536cb0d3c6658c3cc8f65e74c9d349c4d61d1b01856`.
The API resolves it by the registered network and contract, including the
mainnet native contract and Makalu's LAX contract. A matching symbol alone
does not select the artwork or grant verification. This avoids depending on
Degens or Ignite availability each time the profile loads.

Amount, coin icon and symbol use a shared center alignment. Token symbols and
their verification seals also use an explicit centered row on mobile and
desktop.

Validation includes 111 indexer tests, 198 API tests and TypeScript checks for
all three services. Nine API integration tests require separate configured
fixtures and were skipped. The bounded audit was also exercised against
PostgreSQL: a production 10,000-block window took 113.741 ms, and temporary
session tables verified missing blocks, mismatched counts and chain isolation.
Those fixture tables were rolled back.

Chromium and WebKit checks passed against both live explorers in light and
dark themes at widths 390 and 1440. Amount/symbol centers matched; icon and
verification centers differed by less than 0.01 CSS pixels. LAX artwork loaded
on both live profiles. No page errors were observed.

Build records:

- [API, initial indexer and Mainnet frontend](https://github.com/KaJLabs/Lithosphere/actions/runs/45626787479)
- [Makalu frontend and critical vulnerability gate](https://github.com/KaJLabs/Lithosphere/actions/runs/45626787483)
- [Final indexer and critical vulnerability gate](https://github.com/KaJLabs/Lithosphere/actions/runs/45631144688)

Follow-up release records and rollback configurations are under
`/opt/lithoscan-mainnet/releases/logo-lag-20261125/` on Mainnet and
`/opt/lithoscan/releases/logo-lag-20261125/` on Makalu. Environment files,
existing service commands/mounts, database and Redis containers were preserved.
Temporary canary containers and their environment copies were removed.

| Service | Final image pinned on the host |
| --- | --- |
| Both APIs | `ghcr.io/kajlabs/lithoscan-api@sha256:c397a65a7ad7627c98860275be34c5501ab9aa0bd45e94d8450a280de47e24e2` |
| Both indexers | `ghcr.io/kajlabs/lithosphere-indexer@sha256:03f7ed9a56827b2c76efed1613122cdc39eca7fffb59190c2a6391703e3fccbf` |
| Mainnet frontend | `ghcr.io/kajlabs/lithoscan-explorer@sha256:db31663b06d772d3effd5b6a04d052a96165432d52845ad5dfa571ed66b27fc4` |
| Makalu frontend | `ghcr.io/kajlabs/lithosphere-explorer@sha256:62b72c57c9e7a08a21fa2c75db891fe591809417dabb3a4692be086923e89b09` |

The final indexer-only activation preserves its preceding configuration in
`compose.before-final-indexer.yaml` and writes
`final-indexer-activated.json`. Restore only the intended service from a
validated release record; the initial follow-up's `compose.before.yaml` also
reverts the API/frontend changes. No blockchain transactions were sent.
