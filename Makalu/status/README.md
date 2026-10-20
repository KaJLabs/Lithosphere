# Status dashboard mobile layout

`mobile-layout.cjs` applies this project's frontend patch to the existing
`status.litho.ai` HTML. It wraps long values, fits full timestamps to their
cards, and allows the grid to fit narrow viewports. It preserves the dashboard
JavaScript, API payloads, health calculations and polling.

Generate a candidate from an exact snapshot of the deployed `/app/public/index.html`:

```sh
node Makalu/status/mobile-layout.cjs status-before.html status-candidate.html
```

The command refuses to overwrite its output or patch unexpected markup. Applying
the transformation twice is idempotent. Build a derived status image containing
the candidate at `/app/public/index.html`; retain the original image and compose
file for rollback. Recreate only the `network-status` service.

With the explorer running locally and the e2e dependencies/browser engines installed:

```sh
node e2e/scripts/verify-client-mobile-layout.cjs --status-html status-before.html --explorer-base http://localhost:3034 --output mobile-layout-results
```

The browser checks cover US/UK timestamps, five status widths, four explorer
widths, and every token tab in Chromium and WebKit. `--before` leaves the status
HTML unpatched to reproduce the overflow. Screenshots and JSON results are written
to the specified output directory. Token API responses use deterministic fixtures.

## Verified rollout — 2026-10-20

The status frontend and the active LithoScan mainnet frontend are deployed.
The explorer runs revision `5e5a8aaa5d62ee717d3cfa2cd714c4e707e1b99c` with image
content hash `875f926ec12e692ba6871cd71b3679b70aaed86c838d353e3f8550a922841a84`.
The status HTML SHA-256 is
`3d9ef48de24fe5683d25383687d4a7f68ab842df93642ea177644afe60cc6183`.

- 52 deterministic Chromium/WebKit checks pass for old US/UK timestamps, card
  containment, tab touch height, vertical clipping and all token tab interactions.
- 74 public Chromium/WebKit checks pass against both live sites, including light
  and dark explorer themes, four explorer widths, five status widths, every tab
  and horizontal/vertical scroll containment. No browser exceptions were observed.
- The explorer container is healthy. The other four active-origin containers
  retained their IDs. The status rollout preserved the other 35 gateway containers.
- The existing gateway-to-origin routing was preserved. The gateway-local
  explorer and its Compose configuration were restored after the earlier local
  rollout attempt. Its health and original revision were checked afterward.
- API, indexer, database, wallet and validator behavior were not changed. Ignite
  is excluded from this client-requested scope.

Build evidence: [image workflow](https://github.com/KaJLabs/Lithosphere/actions/runs/39465967259).
Review: [PR #245](https://github.com/KaJLabs/Lithosphere/pull/245).
