# Lithoscan and Makalu network update — 2026-11-04

The explorer UI, API, and discovery indexer were updated on both
[mainnet](https://lithoscan.ai) and [Makalu](https://makalu.litho.ai).
Source branch: fix/lithoscan-network-20261104. Unrelated working-tree changes in
the primary checkout were preserved.

## Changes

- Transaction fees and native amounts use LITHO. Gas prices use Mafic per gas,
  with a LITHO equivalent on the homepage. Block gas used remains a gas quantity.
- Display ratios: 1 LITHO = 100 Mafic = 10,000 Strat.
  Both live bank APIs define **10^18 raw ulitho per LITHO**. A display
  micro-LITHO is a different unit. See the
  [denomination verification](lithoscan-denominations-2026-11-04.md).
- Light-theme transaction links use dark green (#065f46).
- The hero text begins “An explorer for Lithosphere’s dual-layer…”.
- Successful deployments use the EVM receipt's contract address, even when the
  Cosmos event omits it. Paid fees prefer receipt effective gas price and gas used.
- Background discovery classifies ERC-20, ERC-721, and the repository's LEP100
  contracts, reads metadata without requiring a seed-list entry, and recovers
  contracts from existing transfer records. LEP100 asset-ID-zero supply is supported.
- Token lists refresh automatically and no longer silently stop at 100 contracts.
  Factory-created contracts can be discovered from supported transfer events;
  factory creations without those events require trace-based discovery, which
  this release does not add.
- Discovery does not grant verification. A token badge requires the existing
  source-verification flag plus a deployer wallet ownership proof. The explorer
  verifies a signed, chain-bound session and requires the signer to match the
  stored contract creator. Wallet proof is not identity/business verification.
- Mainnet inclusion storage and earlier indexing/holder/performance fixes were
  reconciled into source. The transaction feed uses inclusion records when that
  storage is enabled, retaining repeated hashes at distinct block positions.
- Existing QUANTTS integration and validator/mobile fixes were preserved.
- Next.js was updated to 15.5.28 after the publish gate detected
  [GHSA-2464-fhr4-w9xw](https://github.com/advisories/GHSA-2464-fhr4-w9xw).

## Missing-statistics diagnosis

Before the fix, mainnet /api/stats/summary returned HTTP 504 after approximately
31 seconds. API logs showed database statement/read timeouts. A cold all-time
wallet-count query scanned and combined millions of EVM rows; its failure rejected
the complete summary. The chain RPC and indexer were still advancing.

The revised query deduplicates each input before combining addresses. The measured
mainnet query finished in 9.47 seconds. Slow analytics run behind shared caches
and bounded response waits, so they can warm in the background while block and gas
data are served. Missing measurements are null/unavailable instead of fabricated
zeroes. The block-time window reads the latest 101 blocks before applying LAG.
Cosmos/EVM aliases are normalized when counting wallets, which changes the
historical address total where aliases had been counted separately.

After warm-up, both public summaries returned populated metrics and no unavailable
fields. An observed mainnet response took 0.82 seconds; later WAN samples ranged
around 0.6–1.4 seconds. These are observations, not a latency guarantee.

The LITHO market-price placeholder has a separate cause: Ignite's LITHO/USDT
market lookup returned 404 and Magma's quote was timestamped
2026-11-02 07:17:07 UTC, outside the 15-minute freshness window. The explorer
continues to wait for a fresh quote instead of publishing that stale price.

## Release and verification

- API and UI source: d829badbd1e324279695389b19b7dfc1eeac3ee0.
- Discovery source includes 1c9e055 (LEP100 support) and dd7a7e4
  (metadata constrained to the database's 100-character names and 20-character symbols).
- [Mainnet image build](https://github.com/KaJLabs/Lithosphere/actions/runs/41821776633)
  passed for API, indexer, and both UI targets.
- [Makalu UI publish](https://github.com/KaJLabs/Lithosphere/actions/runs/41821785026)
  passed its critical-vulnerability gate.
- [Discovery publish](https://github.com/KaJLabs/Lithosphere/actions/runs/41822368655)
  passed; the [metadata-limit follow-up](https://github.com/KaJLabs/Lithosphere/actions/runs/41824736791)
  supplies the final discovery safeguard.
- API: 189 tests passed; 9 database integration tests were skipped locally.
  Indexer: 69 tests passed before the added metadata-limit regression, which
  passed with the six-test discovery suite. Explorer: 152 tests passed.
- API/indexer TypeScript builds and explorer type checking passed.
- Live Chromium and WebKit checks passed on both public sites in both themes:
  correct network label, Mafic gas prices, LITHO fee display, readable transaction
  links, token badge eligibility, and no browser exceptions. Homepage widths
  320, 390, and 1440 pixels had no horizontal overflow.
- Discovery brought the observed token lists to 26 entries on Makalu and 3 on
  mainnet, including native LITHO. Counts and metrics continue to change.

Existing Compose configuration was backed up on each host. Releases used pinned
images, preserved database/cache volumes and network configuration, and reconciled
the mainnet runtime overlays into source. Mainnet build metadata was aligned with
the actual image revisions. The temporary API used for validation was removed.

Local diagnostic records and screenshots are in .inspection/explorer-20261104.
Server rollback records are in each stack's releases/network-explorer-20261104
directory; the initial API repair backup is under
/var/backups/lithoscan-explorer-20261104 on the mainnet origin.
