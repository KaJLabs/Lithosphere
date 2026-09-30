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

For each canonical operation, every signer durably commits to one path:

- `release`; or
- `refund`, which covers destination cancellation followed by source refund.

The journal key is the canonical operation ID. A release-path commitment cannot
be replaced by a refund-path commitment. Cancellation and refund reproduce the
same refund-path commitment. The journal is written and synced before signing,
and evidence is rechecked after the write.

Release signing requires a canonical source deposit, finalized source block,
configured route, authorization expiry at or before the release deadline, and
an active release window.

Cancellation signing requires the release deadline to have passed, the
destination state to remain `None`, and a current authorization. It produces a
destination transaction/block record.

Refund signing requires the exact source deposit, exact finalized cancellation
event, matching transaction/block evidence, canonical block recheck and the
route-specific finality delay to have elapsed. A cancellation observed only in
an unfinalized or later-reorganized block is insufficient.

## Adversarial cases

Tests must reject copied client references from another depositor, independent
source-vault collisions, withheld releases followed by refund, release after
cancellation, refund after release, late-mined release ambiguity, insufficient
finality, evidence reorganization, pause/unpause reuse and terminal-path changes
after validator or route rotation.

No route may be activated until its exact finality delay and evidence source are
approved. Three confirmations in the deployment inputs remain an operational
configuration value and do not replace that approval.
