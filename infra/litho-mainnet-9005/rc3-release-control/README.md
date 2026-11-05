# Accepted rc3 operational release gate

This additive gate binds the accepted rc3 artifacts to all seven production
services and the existing pinned organizational release key. It never restarts
a service or submits a transaction. The chain source/executable are unchanged.

Before dispatch, complete `RC3_ACTIVATION_APPROVAL.TEMPLATE.json`, authenticated
Autha/KaJ operational acceptance artifacts and the detached organizational
signature under `approvals/mainnet/rc3/`. Do not convert the R2 candidate
acceptance (`activationAuthorized=false`) into an activation authorization.
Use the protected `l1-mainnet-activation` environment with an independent
reviewer, self-review prevented and administrator bypass disabled.

The workflow pins the immutable release, its accepted source commit, binary,
source/SBOM and rollback identities, and the exact seven-service profile.
Wrong targets, expired windows, missing acceptances and unsigned bundles fail
closed. No secret key or validator signing state belongs in this directory.

After a successful protected workflow, run the same verifier on the target
against the staged executable and signed bundle; independently remeasure live
quorum/IBC/configuration immediately before each serialized operation. A prior
quorum pass is not authority for a later restart. Verify `/proc/<MainPID>/exe`
SHA-256 afterward. An offline gate pass alone does not activate a binary.

Local validation:
`python -m unittest discover -s infra/litho-mainnet-9005/rc3-release-control -p test_rollout_guards.py -v`
