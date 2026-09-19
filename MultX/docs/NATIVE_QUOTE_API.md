# Authenticated native quote/application candidate

`createNativeApplication({pool, providers, sourcePolicies, audience, allowedOrigins})`
assembles `/native-quotes` and `/native-source`. Providers/source policies are Maps
keyed by chain ID from reviewed server configuration. Exact origins are required.
Configure RPC deadlines, DB timeouts, ingress and protected migration credentials.
Standard production startup does not call this factory. No production config is supplied.

- `POST /native-quotes/`: `{sourceChain,destinationChain,inputAmount,minimumOutput,recipient}`.
  Amounts are positive uint256 base-unit strings. Chain IDs are positive, safe and
  distinct. Wallet identity is recovered from the signature, not from the body.
- `POST /native-quotes/:quoteId/accept`: `{}`. Owning EOA only. Atomically creates
  the swap/source intent. Repeated acceptance returns the same swap.

The message is `MultX quote request v1\n` followed by JSON encoding of
`[audience,method,relativePath,keccak256(UTF8(body)),timestamp,nonce]`.
Use the source API's timestamp/nonce/signature headers and replay protection.
SDK `createNativeQuoteBackend` implements this contract. Each request requires a
fresh signature/nonce. HTTPS is required except loopback; redirects are refused.

The registry selects enabled, current exact-input fixed-fill policies owned by
the authenticated wallet, ranked by approved output. Each source policy must match bridge/wrapper and supply approved
`sourceConfirmations`. Acceptance re-resolves the original policy ID, validates
source runtime/plan, destination chain and EOA parties, and checks native balance
minus accepted outstanding commitments plus delivery gas. In DEX-backed mode it
also verifies pool/runtime/reserves, slippage-adjusted output and native backing.

Migration 019 permits at most one accepted quote per approved fixed-fill policy.
A new independently approved version is needed for another fill. Quote expiry
does not free an accepted commitment. Treasury reservations are among cooperating
writers; an independent custodian can still spend funds outside this database.

Route policies require `payoutSender`, `excludedRecipients`, `maxPayoutGas`,
`sourceConfirmations` and `quoteTerms`, alongside existing settlement fields:

- `fundingMode:"prefunded-fixed-fill"` or `"dex-wrapped-native"`, `atomic:false`, `automaticTimeoutRefund:false`;
- nonempty `fundingRef` and `recoveryRef`;
- exactly one fee for source-gas, destination-gas, bridge and protocol, with
  explicit decimal `amountBaseUnits` and chain ID. Source gas is a
  `separate-estimate`. Destination gas is also a `separate-estimate` for
  wallet-owned DEX delivery; bridge and protocol remain included in the fixed
  output. Prefunded delivery keeps destination gas included in the fixed output.

Response terms include the original claimant, approved native output and payout
sender. Actual gas varies. The approved fixed output is paid even if the user's
minimum is lower. DEX-backed terms include a canonical, expiring `destinationQuote`
with pool/path, reserves-derived output and minimum. Acceptance requotes against
the approved fixed output; it does not reserve liquidity on-chain. Quote lifetime
is capped by the DEX quote. Only the pre-funded mode reserves output before DEX
execution. DEX-backed mode reserves DEX, redemption and payout gas, then output
after verified redemption. See [NATIVE_REDEMPTION.md](NATIVE_REDEMPTION.md).

DEX-backed quotes require `settlementHolder` to be the authenticated original
wallet and `settlementAmountBaseUnits` to equal input amount. The accepted bridge
does not redirect or price-convert its attestation. Destination trade signing
comes from that wallet. Acceptance verifies and reserves the wallet's approved
maximum approval/trade gas separately from custody redemption/payout gas.
`createNativeDestinationWalletBackend` and the opt-in web UI expose explicit
approval/trade prompts and durable lost-response reconciliation.

The quote UI requires `VITE_MULTX_NATIVE_ENABLED=true`,
`VITE_MULTX_NATIVE_API_URL`, `VITE_MULTX_NATIVE_API_AUDIENCE`,
`VITE_MULTX_NATIVE_QUOTE_API_URL` and, for DEX-backed delivery,
`VITE_MULTX_NATIVE_DESTINATION_API_URL`. URLs include router mounts. Candidate inputs use
explicit chain IDs and 18-decimal native amounts; production selection needs the
final reviewed chain/asset catalog. No values are enabled here.
