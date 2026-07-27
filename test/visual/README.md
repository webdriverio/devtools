# Layer B — visual regression

Boots the trace **player** against each committed golden fixture and
visual-snapshots every panel with WebdriverIO + [`@wdio/visual-service`].

`player.e2e.ts` walks `READY_ENTRIES` from the capture matrix. For each entry it
serves `fixtures/<id>/trace.zip` through the real backend (`serveFixture` →
`readTraceZip` + `start({ trace })`), loads the player in headless Chrome, then
snapshots the full player plus the timeline, controls, snapshot/viewport,
actions, console, network, errors, and a11y panels. A block whose fixture is
missing is skipped, so the suite is green on a fresh checkout and meaningful
once fixtures exist.

`dashboard.e2e.ts` is a skipped scaffold for the live dashboard — it awaits
Phase 1b (`fixtures/<id>/live-events.json` + a live-serve helper).

## Running

```
pnpm fixtures:regen                       # produce the golden trace.zip fixtures first
npx wdio run test/visual/wdio.conf.ts
```

Requires `@wdio/visual-service` installed and a local Chrome/chromedriver.

## Baselines

Committed goldens live under `baseline/`. The config sets `autoSaveBaseline`, so
the **first run seeds** the baselines — commit them, and later runs assert a 0%
mismatch against them. Actual/diff images from a failing run land in `.tmp/`
(not committed). An intended UI change is accepted by deleting the affected
baseline images and re-running to reseed.

[`@wdio/visual-service`]: https://webdriver.io/docs/visual-testing
