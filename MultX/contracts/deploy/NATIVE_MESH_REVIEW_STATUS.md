# MultX native-mesh review status

Status: **BLOCKED_PENDING_KEY_ROTATION**

The native-liquidity contract implementation is available for source review and
testing. A deployable plan must not be generated yet.

`0x4E7d740Af889EADcC902F9304315677E479aB3b6` is recorded as unavailable and is
still assigned as both a bridge signer and the production fee payer. It is also
an owner of the governance Safe outside this repository. Before the deployment
inputs can move to `READY_FOR_REVIEW`:

1. The two accessible Safe owners must replace the unavailable owner on
   Ethereum, BNB Chain and Base.
2. Chain/Governance owners must nominate and approve a replacement bridge
   signer and custody owner.
3. The production fee-payer assignment must be updated and approved.
4. The updated on-chain Safe state and private signer evidence must be verified.

The plan builder enforces these gates. MultX, release signing, relaying and Swap
remain disabled.
