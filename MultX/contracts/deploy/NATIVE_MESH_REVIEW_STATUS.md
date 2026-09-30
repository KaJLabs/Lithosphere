# MultX native-mesh review status

Status: **BLOCKED_PENDING_KEY_ROTATION**

The native-liquidity contract implementation is available for source review and
testing. A deployable plan must not be generated yet.

`0x4E7d740Af889EADcC902F9304315677E479aB3b6` is recorded as unavailable and
remains an owner of the governance Safe outside this repository. The approved
bridge-signer replacement is
`0x3fe6eD17fda54607f06E347158317A0bEE1B1202`; the approved fee payer is
`0x801E74047FDb7dE035e81f3Bc64E2C51661d5Ba0`. Before the deployment inputs can
move to `READY_FOR_REVIEW`:

1. The two accessible Safe owners must replace the unavailable owner on
   Ethereum, BNB Chain and Base.
2. The operator Safe replacement must be executed on Ethereum and BNB Chain,
   retaining the 3-of-5 threshold. The Base replacement is verified complete
   in transaction
   `0xaa5ce2aac91a2e2f6d13d08f359f2fe97c1df7d83416cbf19bf26bbba8ece306`.
3. The updated governance and operator Safe state and replacement signer
   evidence must be verified.

The plan builder enforces these gates. MultX, release signing, relaying and Swap
remain disabled.
