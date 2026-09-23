# DNNS explorer acceptance record

- **Workstream:** MX-04
- **Environment:** Makalu explorer reading the Kamet DNNS registry
- **Status:** Interface and cache policy confirmed; reverse record, public documentation, and named acceptance pending
- **Last verified:** 2026-09-23 20:13:57 UTC

This record separates facts verified from deployed contracts and source-controlled deployment metadata from items
that still require the DNNS owner's confirmation. It must not be marked accepted until every open item below has a
named approver and evidence.

## Verified deployed v0 baseline

The deployed v0 custom contract source and public deployment manifests are now
published in [`DNNS/`](../DNNS/). [`DNNS/PROVENANCE.md`](../DNNS/PROVENANCE.md)
records their origin at
`contracts/dnns/` commit
`b6669f2aca38f3cb8680e8086920d244c260eeae`; that former KaJ Labs repository is
no longer publicly available. The Makalu explorer performs read-only
resolution against the Kamet deployment because the same EVM address can be
used across Lithosphere chains.

| Field                    | Verified value                                 |
| ------------------------ | ---------------------------------------------- |
| Network                  | Kamet                                          |
| EVM chain ID             | `900523`                                       |
| RPC                      | `https://rpc-3.litho.ai`                       |
| TLD                      | `.litho`                                       |
| Supported name form      | One second-level label only (2LD)              |
| Registry                 | `0x316dc15bF377F7187e5BE38BA19e673Ca823d1ab`   |
| Base registrar           | `0xB3D1a8e92FFAD73Ab8a07BF37A8E1374df8B3722`   |
| Controller               | `0xb042145B0Fd44b53691b59E98bE8F9F9EB0365c5`   |
| Original resolver        | `0xc0F0849e09Df12E54fe4345ab4535B1F521f2190`   |
| Wrapper-aware resolver   | `0x54639d978418766ccaD25ffb22C58fd5A5Df8C09`   |
| Reverse registrar        | `0xDeFae50866342C8f72bd03292FFeAeb53eC781C2`   |
| Reverse default resolver | Not configured in the latest deployment record |

The deployed portal rules normalize labels to lowercase and require at least three characters, using only
`a-z`, `0-9`, and internal hyphens. Leading/trailing hyphens and subdomains are rejected. The explorer now applies
the same rules before making an RPC request.

## DNNS owner confirmation — 2026-09-24

The DNNS owner confirmed that the Kamet v0 deployment in the table above remains the supported explorer interface,
including RPC, TLD, registry, original resolver, wrapper-aware resolver, reverse registrar, and normalization rules.
The owner nominated `kamet.litho` <-> `0xE9267bDf7084815B0754545049AE45FE744Aefa8` as the stable reverse-resolution
fixture and approved the explorer policy of retaining no persistent positive or negative resolution cache. Reverse
names remain displayable only after successful forward verification.

This confirmation is not final acceptance. Its acceptance line still contains placeholders for the approver's full
name/role and date, and is explicitly subject to successful smoke tests. The owner also committed to correcting the
public documentation, but that correction is not yet live.

## Live forward-resolution evidence

On 2026-08-19, direct read-only JSON-RPC probes reconfirmed chain ID `900523`, bytecode at the registry address, and
the following registry/resolver results. Each name currently resolves to
`0xE9267bDf7084815B0754545049AE45FE744Aefa8` through its registry-selected resolver:

| Name             | Result |
| ---------------- | ------ |
| `litho.litho`    | PASS   |
| `kamet.litho`    | PASS   |
| `makalu.litho`   | PASS   |
| `dex.litho`      | PASS   |
| `treasury.litho` | PASS   |
| `team.litho`     | PASS   |
| `faucet.litho`   | PASS   |
| `quantts.litho`  | PASS   |
| `bridge.litho`   | PASS   |

These records provide more than the two stable forward fixtures required by the acceptance gate. They do not prove
reverse resolution: the reverse node for the shared address currently has no resolver.

Repeat the transaction-free live baseline with:

```bash
cd Makalu/explorer
pnpm --ignore-workspace verify:dnns-baseline
```

The command reads chain identity, registry bytecode, every forward fixture, the reverse node, and the public DNNS
README. It does not register, update, or submit any transaction. Its 2026-08-19 result remains externally blocked:
all nine forward fixtures pass, no reverse fixture is configured, and the public documentation still describes
Makalu `700777` without publishing the verified Kamet registry address.

The same transaction-free command was repeated on 2026-09-20 from current `main` with the same result: all nine
forward fixtures passed, the reverse resolver remained unset, and the public documentation still omitted Kamet
`900523` and the verified registry address. No transaction was submitted.

The command was repeated again from current `main` on 2026-09-23 at 20:13:57 UTC. Chain ID `900523`, registry
bytecode, and all nine forward fixtures passed; `kamet.litho` resolved to the owner-nominated checksum address. The
reverse node for that address still returned the zero resolver, so no reverse name could be read or forward-verified.
The public `KaJLabs/DNNS` README still described Makalu chain ID `700777` and omitted both Kamet `900523` and the
verified registry address. No transaction was submitted. One immediately preceding probe received HTTP 502; three
subsequent chain-ID probes and the complete baseline succeeded, so this is retained as transient RPC evidence rather
than ignored.

The focused explorer suites also passed 11/11 tests (`dnns-resolver.test.ts` and `dnns.test.tsx`) on 2026-09-23,
covering forward and reverse behavior, absent records, malformed names, provider/RPC failures, forward verification,
and the no-persistent-result-cache boundary.

## Explorer behavior and automated gates

- [x] Forward results are checksummed before navigation.
- [x] An unset name returns "not found" while an RPC/provider failure is reported as unavailable.
- [x] Negative results are not cached for the life of the explorer process.
- [x] Malformed `.litho` names are rejected before RPC access.
- [x] Reverse names are displayed only after the name resolves forward to the queried address.
- [x] Components handle reverse-provider failures without an unhandled promise rejection.
- [x] Record the merged PR, deployment run, and live explorer release below.

## Documentation/interface discrepancy

The public [DNNS documentation](https://dnns.litho.ai/) links to
[KaJLabs/DNNS](https://github.com/KaJLabs/DNNS). That repository was last updated at commit
`3a0cd40df92b` and describes a newer Makalu-oriented reference architecture.
Its Contracts link is broken, it does not link to the now-republished v0
source or deployed addresses, and its network details do not match the Kamet
v0 deployment used by the explorer. The DNNS owner must choose one of these
outcomes:

1. Confirm the Kamet v0 deployment above remains the supported explorer resolution interface and update the public
   documentation accordingly; or
2. Provide the reviewed Makalu registry/resolver deployment metadata and migration date, after which the explorer
   configuration and tests must be updated before acceptance.

No network or contract migration should be inferred from documentation alone.

## Remaining owner acceptance

- [x] DNNS owner confirms which deployed interface is supported for the Makalu explorer.
- [ ] DNNS owner corrects/publishes authoritative network IDs, contract addresses, normalization, and reverse rules.
- [x] DNNS owner nominates one stable reverse record and supplies its expected name/address pair.
- [ ] DNNS owner configures the nominated reverse record on-chain; the live reverse node still has no resolver.
- [ ] Dev Infra repeats live forward, missing-name, malformed-name, RPC-failure, and forward-verified reverse tests
      against the deployed explorer release.
- [x] DNNS owner approves the no-persistent-cache policy or supplies bounded positive/negative TTL requirements.
- [ ] DNNS owner signs the acceptance fields below.

## Evidence and approval

| Field                    | Value                                                                                                                         |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| Explorer PR              | [#86](https://github.com/KaJLabs/Lithosphere/pull/86)                                                                         |
| Merge commit             | `c5448da8c617cf06083f9c08be7e08bd1b5cb6b2`                                                                                    |
| Deployment workflow/run  | [31826844798](https://github.com/KaJLabs/Lithosphere/actions/runs/31826844798) — PASS                                         |
| Deployed release         | `c5448da8c617cf06083f9c08be7e08bd1b5cb6b2`                                                                                    |
| Live smoke-test artifact | Public version, home, blocks, shipped-bundle, and two forward-record probes recorded in the MX-04 handoff ledger (2026-08-14) |
| DNNS approver            | Pending                                                                                                                       |
| Approval date            | Pending                                                                                                                       |
| Approval evidence        | Pending                                                                                                                       |
