# DEX-backed native redemption candidate

This internal service supplies native output from a destination V2 trade. It is
not a public API or an enabled production worker. Apply migrations 009 through
021 in order using the tracked migration runner.

An approved route needs `quoteTerms.fundingMode:"dex-wrapped-native"`, the existing
settlement fields, `destinationDex` (including positive base-unit `maxGas`) and:

```json
{
  "nativeOutput": {
    "kind": "wrapped-native-redemption",
    "wrapper": "<approved nonzero address>",
    "wrapperCodeHash": "<reviewed runtime hash>",
    "approvalRef": "<independent wrapper approval>",
    "confirmations": 12,
    "maxGas": "120000"
  }
}
```

These are example limits, not production approvals. Wrapper/address/hash must
match the destination venue's `tokenOut`. The wrapper must support the reviewed
`withdraw(uint256)` behavior and pay native currency to the calling EOA. A native
precompile without that behavior cannot be used as this adapter's wrapper.

1. Verify source lock, bridge release and final destination DEX token credit.
2. `prepareNativeRedemption` locks the swap and sender, checks runtime, DEX evidence,
   wrapped reservations, nonce and gas funds, and persists an unsigned legacy
   withdrawal of exactly `native_swaps.minimum_output`.
3. Custody signs externally. `bindSignedNativeRedemption` compares every executable
   and fee field to the original plan and durably binds its exact hash.
4. `submitBoundNativeRedemption` rechecks eligibility, funds and gas and submits
   only those original bytes. Response loss is uncertain; reconcile the bound hash.
5. `verifyNativeRedemption` checks exact successful transaction, canonical final
   block, pinned runtime, wrapped debit and native custody credit adjusted for gas.
   Historical balances require archival reads. Same-block unrelated activity can
   affect balance deltas; custody and wrapper semantics remain review boundaries.
6. Only verified canonical redemption permits native payout. Migration 021 also
   refuses payout draft insertion without matching redemption evidence.

`reconcileNativeRedemptionBatch` verifies bound receipts without signing/broadcast.
The local monitor's `--with-dex` mode scans DEX, redemption and payout evidence.
It does not obtain keys or initiate a trade/withdrawal. A production custodian and
reviewed orchestration transport are still required.

RPC operations have 15-second observation deadlines; a timed-out broadcast may
still succeed. Never reset a hash/nonce reservation based on a timeout. Reorganized
evidence blocks later execution. Recovery follows
[NATIVE_RECOVERY_RUNBOOK.md](NATIVE_RECOVERY_RUNBOOK.md); no automatic refund,
replacement withdrawal or payout exists.
