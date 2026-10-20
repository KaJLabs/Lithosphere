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
