# MultX O-01 rollback procedure

Status: fail-closed procedure. It authorizes no transaction.

## Stop triggers

Stop on any chain-ID, runtime hash, owner, guardian, quorum, route, asset, cap,
finality, RPC, liquidity, custody or evidence mismatch. Also stop on signer
equivocation, lost journal continuity, abnormal settlement, reorg beyond policy,
monitoring loss or inability to reconcile an original transaction hash.

## Before any deployment

Abort the window. Load no deployer credential, create no transaction and retain
the rejected plan plus validation output. No on-chain rollback is required.

## Paused deployment or canary rollback

1. The incident owner declares `STOP`, records UTC time and opens the retained
   evidence record.
2. The pause guardian pauses every affected bridge. If already paused, verify
   the state independently on each chain.
3. Keep `MULTX_ENABLED=false`, signer release signing disabled, release relaying
   stopped, Swap disabled and public execution routes unavailable.
4. Block coordinator access to signer TCP/9443 and stop coordinator polling.
   Do not erase signer keys, state identities, journals or logs.
5. Stop new quotes and submissions. Preserve original signed bytes, nonces,
   transaction hashes, block hashes, route policy and custody references.
6. Reconcile each in-flight operation from its actual chain-visible asset
   location. Never infer that a missing RPC response means a transaction was not
   sent; never create a replacement payout or automatic refund.
7. Restore the last approved immutable API/UI configuration only after hashes
   and database compatibility are verified. Keep all execution flags disabled.
8. Export sanitized monitoring, pause, host, database and reconciliation
   evidence to the approved evidence store and apply the approved retention.
9. Require independent review of the incident and restored disabled state.

## Recovery and re-entry

Restore a signer only from its custodian-approved encrypted key backup, retained
state identity and latest reconciled journal. Restore the coordinator/database
into an isolated environment first and prove chain identity, cursor state and
read-only evidence queries. Never initialize a previously active signer as a new
identity or truncate its journal.

Re-entry starts from a new paused-deployment or canary approval. A prior approval
does not survive a rollback, material configuration change, signer rotation,
address/runtime change or route-policy change. Activation always requires a new
explicit governance approval.

## Required drill evidence

- pause transaction/reference and independent paused-state verification;
- proof that MultX, signing, relaying and Swap remained disabled;
- signer isolation and journal-preservation results for all five hosts;
- database/coordinator restore and cursor reconciliation result;
- in-flight settlement reconciliation with no duplicate payout;
- monitoring/alert delivery and named acknowledgements;
- immutable image/config hashes, evidence-store reference and UTC window;
- named operator, incident owner and independent reviewer disposition.
