# MultX O-01 operator responsibilities

Status: preparation only. MultX, bridge signing, release relaying and Swap remain disabled.

## Responsibility boundary

| Role | Responsibility |
| --- | --- |
| Governance/chain owners | Approve governance, routes, finite caps, finality, deployment window, canary and activation. |
| Signer custodians | Control one signer identity and host each; provide management public key/IP, recovery evidence and acceptance privately. |
| Infrastructure/coordinator owner | Operate the dedicated coordinator; provide its source allowlist and public mTLS client-CA reference privately. |
| BrewCodeDev operator | Validate inputs, install immutable images in disabled mode, configure policy/mTLS/journals, run recovery and monitoring drills, and return sanitized evidence. |
| Independent reviewer | Accept the completed O-01 evidence and later verify paused deployments and canary evidence. |

BrewCodeDev does not approve custody on behalf of a signer, select governance
parameters, authorize transactions or activate MultX.

## Confirmed public signer mapping

The bridge quorum is 3-of-5. The host labels identify slots; they do not prove
custody independence.

| Host | Signer | Address |
| --- | --- | --- |
| 1 | Coltre MultX | `0x903AA7a6fc37F1947B6e4fC3832139A8D4152149` |
| 2 | LiLe MultX | `0x8A21FeDfB1782F446C3b6D3062dd31E3b5392d4c` |
| 3 | Ole MultX | `0x4E7d740Af889EADcC902F9304315677E479aB3b6` |
| 4 | MulVAL | `0x801E74047FDb7dE035e81f3Bc64E2C51661d5Ba0` |
| 5 | M MULTX | `0x5A1833A4b204BE2BAb278886Dcc25c2332DFaA63` |

For every slot, retain the named custodian/entity, SSH public-key fingerprint,
management IP/CIDR reference, recovery owner and acceptance record in the
private infrastructure repository. Never place credentials or private endpoints
in the public repository.

## Confirmed governance inputs

- Governance Safe: `0x7697e90dd65D865e9BB44B3a8523A8E064dE8Aef`.
- Safe owners: `0x3fe6eD17fda54607f06E347158317A0bEE1B1202`,
  `0xBd672D23F0CC5D5946c0f4d0eC15339a541dD6B5`, and
  `0x4E7d740Af889EADcC902F9304315677E479aB3b6`.
- Safe threshold: 2-of-3.
- Timelock delay: 48 hours.
- Fee payer and settlement/gas replenishment owner:
  `0x4E7d740Af889EADcC902F9304315677E479aB3b6`.
- Proposed deployer, pause guardian, DEX execution, payout custody, liquidity
  and recovery authority: the Governance Safe above.

Ethereum and BNB Safe evidence has been reported. Base deployment and every
Safe -> Timelock -> Bridge control path must still be proven from the paused
deployment. These assignments do not resolve the remaining independent
governance findings by themselves.

## Initial production scope

The initial rollout contains the six directed native-asset routes among
Ethereum (1), BNB Chain (56) and Base (8453). LITHO (9005), Solana and Bitcoin
are later phases and must not be inserted into this deployment plan.

The 15 September route record approved the technical design and proposed finite
caps: 10 ETH/day on Ethereum, 100 BNB/day on BNB Chain and 10 ETH/day on Base.
It proposed exactly three confirmations for each settlement stage. A durable
approval reference and independent cap/finality acceptance remain required.
Deployment-derived bridge, representation-token, router, factory, pool, path,
runtime and funded-liquidity records remain absent.

## Operator execution gates

The operator may prepare configurations and run transaction-free checks now.
Signer installation requires the private custody and coordinator inputs. A
paused deployment additionally requires all of the following:

1. an exact immutable reviewed release and bytecode-evidence identity;
2. a validated production plan with no placeholders;
3. authenticated approvals for governance, finite caps and finality;
4. named deployer, independent reviewer and incident/rollback owner;
5. an explicit UTC window authorizing **paused deployment only**;
6. funded deployer/fee-payer evidence through the approved custody process;
7. a tested rollback procedure and evidence-store/retention reference.

Canary and activation require later, separate written approvals.
