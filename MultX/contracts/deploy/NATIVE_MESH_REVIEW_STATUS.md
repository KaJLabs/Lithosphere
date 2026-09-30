# MultX native-mesh review status

Status: **BLOCKED_PENDING_SIGNER_EVIDENCE**

The native-liquidity contract implementation is available for source review and
testing. A deployable plan must not be generated yet.

`0x4E7d740Af889EADcC902F9304315677E479aB3b6` is recorded as unavailable and has
been removed from both Safes on Ethereum, BNB Chain and Base. The approved
bridge-signer replacement is
`0x3fe6eD17fda54607f06E347158317A0bEE1B1202`; the approved fee payer is
`0x801E74047FDb7dE035e81f3Bc64E2C51661d5Ba0`; and the new Governance Safe owner
is `0x8A21FeDfB1782F446C3b6D3062dd31E3b5392d4c`.

Both Safe rotations and their thresholds are verified. Before the deployment
inputs can move to `READY_FOR_REVIEW`, the replacement bridge signer's custody,
recovery and signing-policy evidence must be renewed and independently
accepted.

The plan builder enforces these gates. MultX, release signing, relaying and Swap
remain disabled.
