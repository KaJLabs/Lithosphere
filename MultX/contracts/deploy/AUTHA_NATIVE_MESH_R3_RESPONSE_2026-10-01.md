# Native mesh R3 remediation response

This is a disabled review candidate addressing the open findings in
`AUTHA_NATIVE_MESH_R3_REVIEW_2026-10-01.md`. Independent acceptance and all
production approvals remain outstanding.

| R3 item | Change and verification |
|---|---|
| R3-H01 | The append-only journal now permits cancellation and refund certificate renewal only after the previous certificate expires, with a later expiry, the same operation commitment and authority epoch, and a new decision hash. The policy reruns destination/source evidence before and after each write. Three intact journals renewed both certificates after restart; the two-chain service test renewed and executed both after their first certificates expired. Duplicate delivery and early/drifted renewals are rejected. |
| R3-M01 | Finalization and refund recheck the exact terminal block/hash and current finalized destination state after dependent reads. A mid-verification fork is rejected in targeted tests. Finalization records a provisional payout proof before the second check, advancing to a payout decision only after that check succeeds; a failed check leaves an intact-journal recovery path. |
| R3-M02 | Receipt success, canonical block, approved-vault events and vault state establish internal calls; the outer transaction recipient is no longer required to be the vault. The two-chain test uses an actual contract wallet for deposit and contract relayer for payout/cancellation. |
| R3-M03 | The paused-deployment verifier allows only well-formed canonical `LiquidityFunded` events after the constructor and still rejects all other post-constructor events. It reports observed funding and the entire unapproved balance; nonzero value requires separate reconciliation before activation. A real paused vault accepts zero-value and value-bearing unsolicited calls in the test. |
| Missing quote | Release still requires the approved signed quote. Cancellation verifies the real pending deposit and final destination `None` state without requiring quote authority; this permits safe expiry/recovery of a direct on-chain deposit that lacked a quote. |

The local rehearsal uses disposable EVM nodes and test-mode signer transport.
It is not production mTLS or custody evidence. Fresh independent source-to-build
reproduction, full retained Linux results, finality/RPC and route approvals,
tooling-risk acceptance, signer custody, governance, paused-deployment approval,
canary and activation remain separate gates. Production signing, relaying, Swap
and activation remain disabled.
