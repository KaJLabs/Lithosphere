# LithoScan rollout — November 25, 2026

The API and frontends on `https://lithoscan.ai` and `https://makalu.litho.ai`
run `df0b7da89d521751b59aa5a104510b5aefdb1773`. Both indexers run
`adfc9f35270ab3c01818925752fb69c7bfe93876`.

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
