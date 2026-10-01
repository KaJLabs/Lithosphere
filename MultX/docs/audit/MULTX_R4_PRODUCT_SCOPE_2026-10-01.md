# Native mesh R4 product boundary

R4 covers the `NativeLiquidityVault`, its five-signer native settlement service,
and paused-deployment verification. It is a disabled protocol review candidate,
not a complete browser-to-vault product or a production release.

The older API/SDK/web application uses wrap, approve and bridge-lock steps. Its
`prefunded-fixed-fill` and `dex-wrapped-native` modes are **excluded** from the
R4 vault release and remain unmounted in normal API startup. The fixed-fill
reservation finding FS-M01 remains open for that application. The direct EOA
payout proof was corrected for FS-M02, but this does not approve either mode.

No combined API/SDK/web test count may be presented as an end-to-end R4 vault
test. A product release requires a reviewed vault-specific API, SDK and web
workflow, including deposit, payout, expiry, cancellation, refund and recovery;
real-wallet tests; independently reproduced build and source provenance;
production custody/finality approval; and separate paused-deployment, canary
and activation authorizations.

Until those gates pass, MultX, release signing, release relaying and Swap remain
disabled. The older application's routes and fixed fills must not be activated
under an R4 vault approval.
