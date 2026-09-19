# Consolidated native candidate threat model — 2026-09-13

This extends the bridge threat model for the new native candidate. Independent
acceptance remains required. Current bridge quorum is 3-of-5; governance Safe
ownership/threshold and native payout/DEX custody are separate authorities.

## Trust boundaries

- User request: EOA EIP-191 signatures bind deployment audience, method, relative
  path, exact serialized body, timestamp and nonce. Atomic nonce consumption
  rejects replay. Contract-wallet EIP-1271 auth and delegated sessions are absent.
- Approved policy: trusted operators provision immutable route versions and source
  configuration. Users cannot supply executable targets, runtime hashes, providers
  or custody settings. Revocation blocks progression without deleting history.
- Source wallet: exact native wrap/approve/lock, one immutable API submission mode,
  exact signed hashes and durable send-only reservations. Other independent wallet
  actions cannot be prevented. Lost/rejected prompts stop rather than resend.
- Destination wallet: a separate EIP-191 namespace binds status, approval and
  trade requests to the original settlement holder. Migration 022 fixes the mode,
  plan, first attempt, nonce and transaction hash. The SDK derives a canonical
  tuple key, so JSON object ordering or address casing cannot create another local
  send permission. Identity and chain are rechecked after reservation.
- Chain evidence: providers must be independently trusted and bounded. Source,
  release, DEX and native output require matching parties/assets, current canonical
  blocks and approved finality. Test fixture RPCs are not production assurances.
  Bridge release must preserve source holder/amount; pricing and custody cannot
  silently change the attested source tuple. Destination trading needs authority
  from the wallet receiving settlement. A DEX operator has no implicit delegation.
- Bridge signers: three compromised signers can authorize false releases. Operators,
  mounted key/journal identity, mTLS and policy enforcement need real evidence.
- Native custody: destination DEX/payout EOA custodians are independently trusted.
  A signing Safe does not make an EOA payout 3-of-5. External custodians can bypass
  cooperative database reservations or spend funds elsewhere.

## Funding and failure invariants

Each fixed-fill approval permits one accepted quote. Acceptance locks the policy
and sender, checks native balance and reserves approved delivery commitments.
Pre-funded mode reserves output plus payout gas. DEX-backed mode reserves the
original wallet's approval/trade gas separately and custody withdrawal/payout gas
before redemption, then output plus payout gas afterward.
Other accepted quote commitments and non-quote payout drafts are accounted for.
Payout preparation/submission, withdrawal and DEX gas submission preserve these reservations.
These are conservative off-chain checks, not on-chain escrow or a solvency proof.
Signed gas prices can age and external activity can make execution unavailable.

The quote exposes fixed native output, fee accounting, original claimant, funding
and recovery references. DEX-backed delivery requires verified output in a pinned
native wrapper, exact externally signed withdrawal, canonical/final wrapped debit
and native custody credit, then native payout. Missing or reorganized redemption
blocks draft, submission and completion. Wrapper runtime semantics and historical
balance accounting must be independently reviewed on the actual destination chain.
Pool quotes/backing are rechecked, not locked; pricing remains an approved fixed
fill. Production backing, route approvals and replenishment need real evidence.

Signed execution stays bound to original plan/hash. Lost broadcast responses are
uncertain; only original bytes can be retried after eligibility checks. Completion
requires verified final native credit. Quote/DEX expiry, nonce drift, RPC failure,
recipient incompatibility and partial completion can strand assets temporarily.
There is no automatic reservation reset, nonce replacement or timeout refund.
Operator recovery must exclude duplicate payout and later settlement.

## Independent review focus

Review atomic acceptance/reservations across cooperating workers, quote/source/
release identity binding, mode isolation, exact signed serialization, receipt and
balance semantics (including withdrawal gas and same-block activity), policy
expiry/revocation, migration reconciliation refusals,
custody/journal recovery, ingress/CORS/EOA auth, supported token semantics and
actual wallet failures. Exercise every production direction against its real
runtime. Verify Safe implementation/fallback hashes and Safe → 48-hour Timelock →
Bridge ownership separately from bridge signer quorum and native EOA custody.

Local test counts do not close any independent finding or authorize activation.
