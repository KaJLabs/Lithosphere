# MultX native settlement protocol

## Canonical identity

An operation is identified by:

```text
keccak256(abi.encode(sourceChain, sourceVault, depositor, depositorNonce, clientReference))
```

The source vault derives this value. Signers reject any request whose operation
ID does not reproduce from the complete source identity.

## States and transitions

The source deposit begins `Pending`. It may become:

- `Finalized` after signers verify a finalized destination payout; or
- `Refunded` after signers verify a finalized destination cancellation.

The destination operation begins `None`. Before its release deadline it may
become `Released`. After every release authorization has expired and the
deadline has passed, it may become `Cancelled`. Both are terminal.

```text
Destination: None -> Released
             None -> Cancelled

Source:      Pending -> Finalized
             Pending -> Refunded (only after final Cancelled evidence)
```

## Signer rules

Each signer keeps an append-only state journal for the canonical operation and
authority epoch. The allowed progression is an initial release authorization,
then a destination cancellation after its deadline and every prior authorization
expiry, then a source refund after finalized cancellation evidence. A verified
destination payout instead makes the operation terminal. Payout and refund
decisions cannot follow one another. The same intact signer can recover an
expired, unused release after a restart or a failed second evidence check.
If cancellation was authorized but an earlier destination release later becomes
final, signers can authorize source finalization after verifying that release;
the destination contract rejects the outstanding cancellation.
The journal is written and synced before signing, and evidence is rechecked
after the write.

Release signing requires a canonical source deposit, finalized source block,
configured route, a quote signed by the approved quote authority, authorization
expiry at or before the release deadline, and an active release window. The
quote signature binds the full canonical source identity, input amount,
destination vault, recipient, output amount and quote expiry. The signer checks
the deposited values against the quote and source contract state.

Cancellation signing requires the release deadline to have passed, the
destination state to remain `None`, and a current authorization. It produces a
destination transaction/block record.

Refund signing requires the exact source deposit, exact finalized cancellation
event, matching transaction/block evidence, canonical block recheck and the
route-specific finality delay to have elapsed. A cancellation observed only in
an unfinalized or later-reorganized block is insufficient.

The signer service exposes separate native release, cancellation, finalization
and refund endpoints. `SIGNER_NATIVE_SIGNING_ENABLED` defaults to false. Enabling
it requires an approved native policy, a matching signer identity and an intact
native state journal. Production native policy is loaded from
`SIGNER_NATIVE_POLICY_FILE`, and the journal path is `SIGNER_NATIVE_STATE_FILE`.
Deployment and activation require separate acceptance; the existence of these
endpoints does not authorize either.

## Adversarial cases

Tests must reject copied client references from another depositor, independent
source-vault collisions, withheld releases followed by refund, release after
cancellation, refund after release, late-mined release ambiguity, insufficient
finality, evidence reorganization, pause/unpause reuse and terminal-path changes
after validator or route rotation.

No route may be activated until its exact finality delay and evidence source are
approved. Three confirmations in the deployment inputs remain an operational
configuration value and do not replace that approval.
