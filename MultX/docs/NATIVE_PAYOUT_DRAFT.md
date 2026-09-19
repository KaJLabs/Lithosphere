# Reserved native payout draft

Current native-redemption requirements and final evidence supersede the historical
test totals below. Routes with `nativeOutput` require verified canonical redemption
before draft preparation. See [NATIVE_REDEMPTION.md](NATIVE_REDEMPTION.md) and
[current completion checklist](NATIVE_SWAP_COMPLETION_CHECKLIST.md).

nativePayoutDraft.js prepares an unsigned direct native transfer from durable swap
terms and the stored route policy. Migration 013 reserves its sender/chain/nonce
and swap identity. Cooperating workers serialize reservations per sender; the
database rejects reuse. Repeated preparation returns the immutable draft after
checking current policy/custody. Revoked or expired policy rejects preparation.

The policy must include payoutSender, custodyRef, excludedRecipients and
maxPayoutGas. The preparer checks chain identity, sender/recipient code, gas estimate
and pending native balance. The draft pays the swap minimum, uses legacy gas price
and a 20% estimate margin within the configured gas ceiling. This is a candidate
fee strategy, not approval of production parameters. Excluded recipients must
cover chain-specific precompiles/system addresses; empty code alone cannot prove
that an address is an EOA.

No keys are loaded and no signing/broadcast/status completion occurs. custodyRef
records an operator assignment; it does not prove key possession. This adapter
does not support Safe/contract senders. Choosing an EOA payout operator is still
an explicit custody decision, separate from the bridge's validation signer set.

The stored draft is not a reusable execution authorization. Before signing or
broadcast, recheck policy, source/destination finality, balances, fee limits and
nonce against this reservation. External wallet use can consume its nonce; stop
and reconcile rather than silently creating another payout. Existing drafts are
immutable and are not automatically repriced or replaced. Providers must enforce
request deadlines; preparation currently holds locks across its RPC calls.

Real PostgreSQL tests cover insufficient funds, wrong network, contract-party
rejection, concurrent idempotent preparation, immutable reservation and revocation.
All 137 API tests pass. RPC fixtures and approvals are synthetic. No production
migration or payout was performed.
