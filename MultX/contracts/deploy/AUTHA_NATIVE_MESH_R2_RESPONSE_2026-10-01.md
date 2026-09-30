# Native mesh R2 remediation response

This response addresses the source findings in
`AUTHA_NATIVE_MESH_R2_REVIEW_2026-10-01.md`. It is a review candidate only.
Production deployment, signing, relaying, Swap, canary and activation remain
disabled pending independent acceptance and separate authorization.

| R2 item | Change and local verification |
|---|---|
| R2-H01 | A separate append-only native journal stores release, cancellation, payout and refund states with operation/epoch binding. The same three signers recover an expired unused release after restart, including a post-journal evidence failure. A cancellation authorization can yield to a later confirmed payout. |
| NM-H01 | The signer HTTP service now has native release, cancellation, finalization and refund handlers, independently disabled by default. The evidence verifier checks the approved quote signature, canonical source deposit and current pending state, destination payout/cancellation receipts and events, finality, and source refund state. A two-process local EVM rehearsal uses actual vaults and three signer HTTP processes to complete payout/finalization and an expired-release cancellation/refund. |
| NM-M02 | The final-anchor deployment verifier rechecks the exact Safe policy, reconstructs all Timelock role holders, rechecks factory runtime, proves empty-before/code-after creation with canonical receipt blocks and required confirmations, and rejects any vault log beyond the constructor. Negative tests cover hidden cancellation history and invalid creation boundaries. Existing governance tests cover changed Safe authority and undeclared Timelock roles. |
| Toolchain | Current production dependency audit is zero; the full development graph has 34 findings. `NATIVE_TOOLCHAIN_RISK_DISPOSITION_2026-10-01.md` records actual use and required controls. Risk acceptance remains open. |

The R2 review already closed NM-M01, NM-M03 and the specific LITHO stale-checkpoint
defect. Independent source-to-build reproduction, Linux signer filesystem tests,
production route/liquidity/custody evidence and governance authorization remain
separate gates. The local two-node rehearsal is not a production-chain test.
