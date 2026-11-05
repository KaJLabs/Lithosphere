# MX-03 Thanos Wallet acceptance

Status: engineering integration implemented and browser-tested; independent wallet-team acceptance remains open.
Do not mark MX-03 accepted until the wallet-team approval record is completed.

## Verified baseline

| Item | Verified value | Evidence |
| --- | --- | --- |
| Target | `https://makalu.litho.ai/signin` | Live route |
| Network | Makalu, EVM chain ID `700777` (`0xab169`) | Explorer network configuration |
| Published Chrome extension | `1.0.10`, updated 2026-10-15 | Chrome Web Store item `jajfgpnlaoakklhnnchdpiglmkkpcehj`, checked 2026-10-18 |
| Published-version source | `imasssad/Thanos-Wallet` commit `e1e134b03b96c0e896fc3fa4d7080da1a30248a2` | Latest successful public [extension-release workflow](https://github.com/imasssad/Thanos-Wallet/actions/runs/38638238001) for `1.0.10`; declares `1.0.10`, EIP-6963, RDNS `fi.thanos.wallet`, `window.thanos`, and EIP-1193 signing |
| Explorer integration | EIP-6963 discovery plus verified `window.thanos` fallback | `Makalu/explorer/components/ThanosSignIn.tsx` |
| Server authentication | Nonce-bound SIWE, one-time replay protection, HMAC bearer session | `Makalu/api/src/routes.ts` and focused tests |
| Makalu session secret | Present, non-placeholder, and at least 32 characters | Value-free production-container check on 2026-08-14 |

The upstream default branch may move beyond the Chrome Web Store release. Run acceptance only with published version
`1.0.10` and the exact source commit pinned above. If the store version changes, re-pin the matching source commit
and repeat the automated preflight before starting the manual matrix.

Run the transaction-free baseline immediately before manual acceptance:

```bash
node Makalu/scripts/verify-thanos-acceptance-baseline.mjs
```

The preflight checks the published version, pinned public source, provider markers, live sign-in route,
unauthenticated session rejection, and Makalu chain identity. It does not connect a wallet, request a nonce, sign a
message, or submit a transaction. The latest passing preflight timestamp is recorded in the MX-03 tracker evidence.

## Wallet-team test record

Record a screenshot, transaction URL, test-run URL, or other durable reference in the Evidence column. Never attach
seed phrases, private keys, session tokens, or deployment secrets.

Use a dedicated low-value acceptance wallet. The client authorized the isolated test-wallet run through "Go ahead"
and subsequent "continue" instructions on 2026-10-18. This authorized testnet execution, not wallet-team sign-off.

| Scenario | Expected result | Result | Evidence |
| --- | --- | --- | --- |
| Fresh extension install | Thanos is detected; no other injected wallet is selected | PASS after discovery fix | Official store 1.0.10 bundle, fresh isolated profile; `window.thanos.isThanos` verified |
| Late provider announcement | Thanos becomes available without a page reload | Automated PASS | `test/auth.test.ts` late EIP-6963 announcement and injected fallback tests |
| Connection rejection | Explorer shows an actionable rejection and creates no session | PASS | Real extension Reject; no `thanos_session` stored |
| Signature rejection | Explorer shows cancellation and creates no session | PASS | Real extension Reject on PERSONAL_SIGN; actionable cancellation and no session |
| Wrong active chain | Explorer requests a switch to Makalu | PASS | Started on Ethereum; switched to `0xab169` before signing |
| Makalu missing | Supported setup allows switching to Makalu | PASS with limitation | Store 1.0.10 rejects automatic addition. Added custom network in Settings and restarted wallet; switch then succeeded |
| SIWE sign-in | Correct address is shown and `/api/auth/me` validates the session | PASS | Real extension Approve & Sign; HTTP 200, address/chain verified |
| Nonce replay | Reusing the signed message is rejected | PASS | Exact signed verify request replay returned HTTP 401 |
| Reconnect | The same authorized wallet reconnects correctly | PASS | Page reload and repeated sign-in passed |
| Sign out | Server-backed local session and explorer wallet state are cleared | PASS | Sign out cleared stored session; sign-in button restored |
| Extension restart | Valid session restores and is server-validated | PASS | Popup close/reopen; complete extension/browser restart also exercised below |
| Browser restart | Valid session restores and is server-validated | PASS | Persistent profile reopened; session HTTP 200 while extension itself correctly required unlock |
| API restart | Existing session remains valid after the API restarts | PASS | Restarted only Makalu API; existing session remained HTTP 200 |
| Low-value transaction | Thanos signs on chain `700777`; transaction succeeds and appears in Makalu Lithoscan | PASS | 0.001 LITHO self-transfer; receipt `0x1`, block 17,922,574 |

## Required transaction evidence

- Transaction hash: `0x9a7a0798b87d76496d27163b022e233e4b4f2d94fd2b94aca50624cedd5f35da`
- Lithoscan URL: https://makalu.litho.ai/txs/0x9a7a0798b87d76496d27163b022e233e4b4f2d94fd2b94aca50624cedd5f35da
- Sender/recipient public address: `0x57BcAeFE7E6353898B500c312aA0ccd4A99CaE5d` (fresh self-transfer wallet)
- Asset and amount: `0.001 LITHO`, testnet only; funded by a single 1 LITHO faucet claim
- Confirmed chain ID: `700777`
- Block timestamp (UTC): `2026-10-18T16:12:56.172Z`
- Funding transaction: `0x36423bedd42f5f59f35e98479776cd6613781937293d5afd0fa4f2da305cfeac`

## Approval record

- Wallet-team approver: `PENDING`
- Approver role or GitHub username: `PENDING`
- Tested Chrome/Chromium version: `153.0.8010.12` (Playwright Chromium)
- Tested Thanos version: `1.0.10`, official Google update-service CRX, loaded unpacked without modifying bundle files
- Test date (UTC): `2026-10-18`
- Acceptance evidence URL: `PENDING`
- Decision: `PENDING`

These are Codex-run engineering results. They do not impersonate wallet-team approval.

## Discovery regression and deployment

With the store extension enabled, the explorer's preference subscription repeatedly called Web3Modal's append-only
`setConnectors`, triggering another notification indefinitely. A CPU profile and paused stack located the loop.
The no-extension control loaded normally. A browser-only patch replacing connector registration with presentation
reordering restored the page. The source fix reorders the controller's existing presentation array and reads current
state when its microtask runs. A regression against the real Web3Modal controller failed before the fix and passed
after it; late registrations retain their backing entries without duplication.

Network tests also exposed that EIP-3085 does not guarantee switching after adding a chain. The explorer now switches
explicitly after successful addition and explains unsupported automatic addition without calling it a cancelled
signature. Thanos 1.0.10 primes custom networks on service-worker startup, so its setup guidance includes restarting
the wallet after adding Makalu. This wallet limitation was not modified or hidden by the explorer tests.

- Wallet/auth/discovery tests passed (15 total across the final focused suites).
- Initial live fix: `f4f45a8ec398e831e2c54b6ca374a5d9541da69d`, [image publication](https://github.com/KaJLabs/Lithosphere/actions/runs/39143557867).
- Final restart wording: `dcec45456a16080362afc5965e7091759bf7b4bb`, [image publication](https://github.com/KaJLabs/Lithosphere/actions/runs/39144175305).
- Final immutable explorer image: `ghcr.io/kajlabs/lithosphere-explorer@sha256:35d8ab5e5cce3a1d224357bd8cb23bf2e558632706e769f3752a3efd6b93b28c`. Deployed and healthy; real-extension sign-in repeated successfully against this unmodified live release. Prior compose/image retained under `/opt/lithoscan/releases/thanos-dcec454/` for rollback.
- API remains the QUANTTS release `14f0ad5a35912a74eacc7c9e7159aab8f5618e62`; only explorer images change for these UI fixes.
- Store CRX SHA-256: `56bd8059be8a76f2c8ad08e5946342b3e6b3120689f90c9260457f2346c45339`.
- Local evidence: `.inspection/thanos-acceptance-evidence.json`, `.inspection/thanos-live-signedin.png`, `.inspection/thanos-live-transaction.png`.

No recovery phrase, private key, wallet password, session token or signed authentication payload is stored in these
records. The browser harness kept secrets in memory and an access-restricted temporary encrypted-wallet profile.

## 2026-10-18 baseline refresh

The transaction-free preflight passed at `2026-10-18T15:41:42.458Z` against the published Chrome Web Store extension 1.0.10 (updated October 15). The matching successful upstream extension release is run `38638238001`, source `e1e134b03b96c0e896fc3fa4d7080da1a30248a2`. Later upstream builds are not assumed to be the store version.

Provider markers, live sign-in HTTP 200, unauthenticated session rejection HTTP 401, and Makalu EVM chain ID 700777 passed. The current Makalu API retains its existing 64-character server session secret; its value was not read into logs or repository files. This does not complete the pending real-extension browser matrix, signed transaction, or wallet-team acceptance. No wallet was connected and no transaction was submitted.
