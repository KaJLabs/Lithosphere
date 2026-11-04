# LithoScan denomination verification — 2026-11-04

## Confirmed chain units

Both public chains currently define **1 LITHO = 10^18 native `ulitho`**, including on the Cosmos bank side. The proposed six-decimal interpretation of the literal on-chain denomination `ulitho` does not match either network's metadata. The display name is unfortunate: these chains explicitly alias the base unit to an atto unit. Cosmos-style naming alone cannot establish the exponent.

Read-only verification on 2026-11-04:

```powershell
curl.exe -sS --max-time 20 https://api.litho.ai/cosmos/bank/v1beta1/denoms_metadata
curl.exe -sS --max-time 20 https://api-mainnet.litho.ai/cosmos/bank/v1beta1/denoms_metadata
```

The relevant response fields were:

| Network | Base unit | Base exponent | Base aliases | Display unit | Display exponent |
|---|---|---:|---|---|---:|
| Makalu | `ulitho` | 0 | `attolitho` | `litho` (`LITHO`) | 18 |
| Mainnet | `ulitho` | 0 | `attoLITHO` | `litho` (`LITHO`) | 18 |

Sources: [Makalu bank metadata](https://api.litho.ai/cosmos/bank/v1beta1/denoms_metadata), [mainnet bank metadata](https://api-mainnet.litho.ai/cosmos/bank/v1beta1/denoms_metadata). These were successful direct HTTP reads; the web browsing tool could not open these JSON URLs.

The repository agrees: the [machine-readable network parameters](network/network-parameters.json) set `nativeDenom` to `ulitho` and `decimals` to 18; the [canonical chain parameters](network/chain-parameters.md) describe the same display precision. The public [official Makalu validator toolkit](https://github.com/lithoagent/litho-makalu-validators#network-overview) also documents 18 decimals. That toolkit contains older endpoint/chain-ID information, so use the live LCD metadata for current denomination authority.

There is **no observed six-decimal bank/eighteen-decimal EVM split** on these two networks. Updating the explorer's `ULITHO_DECIMALS` from 18 to 6 would multiply displayed balances, transfer amounts, and fees by 10^12 relative to the chain metadata. Sources: [explorer constants](../Makalu/explorer/lib/constants.ts), [`formatValue`](../Makalu/explorer/lib/format.ts), and the live bank metadata above.

## Requested display units

The user supplied these product definitions in the 2026-11-04 request:

| Display unit | Value in LITHO | Native base units per display unit |
|---|---:|---:|
| LITHO | 1 | 1,000,000,000,000,000,000 |
| Mafic | 0.01 | 10,000,000,000,000,000 |
| Strat | 0.0001 | 100,000,000,000,000 |
| micro-LITHO (a display unit) | 0.000001 | 1,000,000,000,000 |
| Native `ulitho` / atto-LITHO | 0.000000000000000001 | 1 |

These display definitions are mathematically compatible: **1 LITHO = 100 Mafic = 10,000 Strat = 1,000,000 micro-LITHO**. They do not redefine what the existing on-chain string `ulitho` represents. One Mafic equals 100 Strat and 10,000 display micro-LITHO. These conversions are arithmetic derived from the user's definitions and the observed 18-decimal native scale.

No independent first-party denomination document defining Mafic or the requested Strat ratio was found in the repository or the public official sources searched. Treat those two names/ratios as the user's requested display specification, not a pre-existing on-chain denomination verified by this investigation. Neither currently appears in the live bank metadata.

## Existing gas data path

The explorer API's `gasPriceWei` is the decimal integer returned from EVM `eth_gasPrice`, representing a price **per gas unit**. The API's [`getCurrentGasPriceWei`](../Makalu/api/src/routes.ts) parses the RPC hexadecimal quantity with `hexToDec`, caches it briefly, and includes it in `/stats/summary`. The frontend contract documents that field as wei equal to native `ulitho`. Sources: [API routes](../Makalu/api/src/routes.ts) (gas-price cache and `getCurrentGasPriceWei`, approximately lines 922–944), [API response type](../Makalu/explorer/lib/types.ts).

The [indexer EVM mapping](../Makalu/indexer/src/mappings.ts) stores transaction `value` and `gas_price` as unscaled decimal strings converted from their hexadecimal RPC quantities. The API's `weiToUlitho` is an identity normalization, not a division; `computeFeeUlitho` multiplies `gasUsed` by gas price to obtain a total fee in native base units. Sources: [API conversion/fee helpers](../Makalu/api/src/routes.ts) (approximately lines 320–332 and 652–663), [indexer EVM enrichment](../Makalu/indexer/src/mappings.ts) (approximately lines 911–959).

Consequently, use these conversions at the display boundary:

```text
gas price in LITHO/gas = gasPriceWei / 10^18
gas price in Mafic/gas = gasPriceWei / 10^16
gas price in Strat/gas = gasPriceWei / 10^14
total fee in LITHO     = gasUsed × effectiveGasPriceWei / 10^18
total fee in Mafic     = gasUsed × effectiveGasPriceWei / 10^16
```

Use a receipt's effective gas price when available for actual transaction fees; an RPC gas-price quote is a current estimate, not the paid fee of every transaction. The existing API's RPC transaction normalization already prefers receipt `effectiveGasPrice` over transaction `gasPrice`. Source: [transaction normalization](../Makalu/api/src/routes.ts) (approximately lines 1156–1172).

Use integer/string decimal formatting so tiny gas prices remain visible. For example, 7 raw base units per gas means `0.000000000000000007 LITHO/gas`, `0.0000000000000007 Mafic/gas`, or `0.00000000000007 Strat/gas`. These are arithmetic examples, not a claim about the current network quote.

## Identified formatting conflict

At investigation time, [`formatStrat`](../Makalu/explorer/lib/format.ts) divides the raw quantity by **100**, and its existing [tests](../Makalu/explorer/test/format.test.ts) assert `100 raw = 1 Strat` and `7 raw = 0.07 Strat`. Its comment attributes this to matching another explorer's bundle. That scale is incompatible with the requested `1 LITHO = 10,000 Strat` when native amounts have 18 decimals: it overstates Strat values by 10^12. The requested Strat divisor is 10^14; the requested Mafic divisor is 10^16.

Keep native storage, wire quantities, RPC gas settings, and the 18-decimal LITHO formatter unchanged. Add or correct display conversions and labels, and use the same display rules in both explorer builds. Changing how a fee is displayed is separate from changing the validators' minimum gas price or the chain's denomination metadata; this investigation does not recommend a chain redenomination.

## Scope and remaining uncertainty

- The live metadata confirms denomination precision on both networks. It does not prove that all historical explorer rows are indexed correctly or that homepage statistics are healthy.
- The requested Mafic and Strat ratios can be implemented as explicit display rules. Their external publication in canonical product documentation remains a separate follow-up because no existing official definition was located.
- Third-party tokens retain their individual contract `decimals`; the native 18-decimal conversion must not be applied indiscriminately to all discovered token balances.
