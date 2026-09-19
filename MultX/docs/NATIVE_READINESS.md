# Native swap readiness candidate

Migration 012 and nativeSwapReadiness.js bind the source lock, destination release
and stored route-policy version to one swap. The verifier rechecks source
canonicality, verifies destination receipt/credit, and writes destination evidence
and payout_ready together. The database rejects readiness from reference strings
alone. Policy definitions are immutable; enabled can be revoked. Expiry is checked
again after RPC verification. Duplicate concurrent readiness attempts cannot
consume the settlement twice.

Policies are internal operator records, disabled by default. approval_ref and
approved_by must refer to real authorization; the table is not an approval system.
No production policies are supplied. Settlement assignments and source
expectations must be written by trusted coordinator logic. This module does not
accept policy definitions from public requests.

The narrow supported policy mode is direct-native-payout with explicit source
amount, settlement token/amount/holder and fixed minimum native payout commitment.
A liquidityCommitmentRef is a reference to separately verified backing, not a
live liquidity proof. This does not implement general DEX routing or authorize
that settlement design as the production architecture.

137 API tests pass, including real PostgreSQL readiness tests for disabled policy,
missing destination evidence, reorg rejection, immutable policy, concurrency and
rollback after a failure between evidence storage and readiness. Test approvals,
RPC responses and commitments are synthetic. Migration 012 refuses pre-existing
ready/completed swaps pending evidence reconciliation.

Required before execution: actual route deployment/liquidity approval, trusted
assignment creation, sender/custody binding, policy revocation/expiry checks at
payout submission, and native execution adapters. Readiness is a point-in-time
decision, not permanent authorization to send funds. No public execution endpoint,
production migration, payout or activation occurred.
