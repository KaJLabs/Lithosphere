# Native candidate recovery procedure

Retain swap/quote ID, claimant, policy/source plan, signed bytes/hashes, block hashes,
current asset location, all settlement/DEX/redemption/payout evidence and nonce reservations.
Record incident owner and custody approval before moving funds. Production recovery
authority and replacement/refund design depend on the approved funding model.

| Observation | Candidate behavior | Operator action |
| --- | --- | --- |
| Quote rejected/expired before acceptance | No swap or application transfer | Request a fresh approved quote |
| Reserved source or destination wallet attempt, missing hash | No second automatic send | Inspect exact wallet/provider history; authenticated observe can bind the actual hash |
| Known source hash pending/unknown | Retain hash; wait/reconcile | Check canonical provider and nonce; missing receipt does not prove unsent |
| Source reverted or intent expired | Stop progression, retain evidence | Determine native/wrapped/escrow balances; design authorized recovery from actual location |
| Source/release reorg | Refuse new execution authorization | Reconcile checkpoints and signer journals; no time-based refund |
| DEX expired/reverted, quote unavailable, nonce changed | Retain binding and stop | Verify transaction/inventory; review replacement/requote protocol before new execution |
| DEX/redemption/payout broadcast response lost | Find original hash; identical-byte retry when eligible | Custodian retains bytes; reconcile nonce and receipt worker |
| Redemption missing/reverted/reorganized | No payout draft/submission/completion | Verify pinned wrapper, wrapped balance, native balance, original hash and canonical receipt; preserve all reservations |
| Redemption verified, payout blocked | Native output remains in custody and reserved | Reconcile payout hash/nonce and policy; never repeat the withdrawal or invent a replacement payout |
| Final native payout recorded | Completed swap immutable | Never pay/refund again; later source reorg requires incident review |

Migration 020 fixes one API wallet submission mode per intent. Observation needs
the original injected reservation and chain-visible exact transaction. The web UI
offers hash reconciliation for a reserved unresolved attempt. Observation neither
signs nor broadcasts; canonical/finality checks remain required downstream.
Existing submissions need explicit reconciliation before migration 020; it refuses
to guess their mode.

Migration 022 applies the same fail-closed rule to destination approval/trade
steps. It preserves the first attempt, exact executable plan, nonce and hash.
Approval and trade are separate steps; a confirmed approval does not authorize an
automatic trade. Route revocation permits evidence reconciliation for an already
sent exact transaction, but blocks a new send. Never delete a destination attempt
or DEX binding to manufacture another permission.

There is no automatic reservation reset if a wallet prompt was rejected and no
transaction exists. Expired plans may also refuse binding/continuation. Retain hashes
and evidence for operator review. One empty RPC lookup cannot prove absence. Do not
delete reservations, change immutable plans or clear records to offer another send.

There is no automatic timeout refund or nonce replacement. A reviewed protocol must
exclude both later settlement and duplicate payout before refund/replacement. This
runbook defines stop/reconcile behavior; it authorizes no recovery transaction and
does not claim a refund executor exists.
