# Cross-adapter verification harness

Automates the per-adapter verification that was previously manual: run each
framework's example, open the trace, and eyeball that capture is complete and
the UI renders it. Instead:

- **`pnpm verify`** — Layer A: loads each committed golden `trace.zip` through
  the real backend reader, reduces it to a capture summary, and snapshots it;
  **also** snapshots the live-mode WS stream (`live-events.json`) per adapter.
  Fast, no browser, runs in CI.
- **`pnpm verify:ui`** — Layer B: boots the trace player against each fixture and
  pixel-diffs every panel via `@wdio/visual-service`. Local, needs a browser
  (not a CI gate — baselines are host-rendered and won't match another machine).
- **`pnpm fixtures:regen`** — the one browser step for trace mode: re-runs the
  examples in trace mode and refreshes the committed `trace.zip` fixtures.
- **`pnpm fixtures:record-live`** — the one browser step for live mode: runs each
  example in live+reuse mode against a stand-in WS server and refreshes the
  committed `live-events.json` fixtures (the parity projection only — scope
  timeline + command vocabulary; the raw stream is multi-MB and never committed).

## Layout

```
test/
├─ capture/
│  ├─ matrix.ts              entry table (adapters × runners) — the only file that knows adapters
│  ├─ summarize.ts           trace → deterministic capture summary (the snapshotted value)
│  ├─ capture-parity.test.ts expect(summarize(trace)).toMatchSnapshot() per entry
│  ├─ live-summarize.ts      live stream → scope/command projection + summary (record- + test-time pair)
│  ├─ live-parity.test.ts    expect(summarizeLive(live-events)).toMatchSnapshot() per entry
│  └─ __snapshots__/         committed golden summaries
├─ support/
│  ├─ paths.ts               repo/test roots + fixture paths
│  ├─ find-zip.ts            newest-zip finder (used by regen)
│  ├─ record-live.ts         record live WS stream via reuse-mode stand-in (browser step)
│  ├─ serve-fixture.ts       boot the backend on a fixture trace for Layer B (player)
│  └─ serve-live.ts          boot the backend live + stream synthetic events (live dashboard)
├─ visual/
│  ├─ wdio.conf.ts           headless Chrome @ 1600x900 dpr1
│  ├─ player.e2e.ts          per-entry: snapshot the player + each panel (pixel)
│  ├─ live-dashboard.e2e.ts  live dashboard wiring — DOM assertions, no baselines
│  └─ baseline/              committed golden PNGs (54 = 6 entries × 9 panels)
├─ fixtures/<id>/trace.zip        committed golden trace fixture (one folder per entry)
├─ fixtures/<id>/live-events.json committed golden live projection
├─ fixtures/live-synthetic.json   synthetic stream for the live-dashboard e2e
├─ regen.ts                  regenerate trace fixtures (browser step)
└─ vitest.config.ts          standalone project (kept out of `pnpm test`)
```

## How it works

`verify` runs against **committed fixtures**, not live browsers. The fixture is a
frozen known-good input:

- **Change the app / reader / UI** → `verify` catches a regression against the
  frozen fixture, no browser.
- **Change capture** (an adapter, the exporter, the collector) → run
  `fixtures:regen`, then `verify:update` to accept the new snapshot (an intended
  change) or read the diff as a regression.

CI closes the "forgot to regen" gap by re-running `fixtures:regen` when a
capture-layer path changes (see `.github/workflows/`).

## Commands

```sh
pnpm verify                          # Layer A — trace + live snapshot check (no browser)
pnpm verify:watch                    # watch mode
pnpm verify:update                   # seed/accept snapshots after a regen (vitest -u)
pnpm fixtures:regen                  # regenerate all trace fixtures (needs Chrome)
pnpm fixtures:regen wdio-mocha       # regenerate one trace fixture by id
pnpm fixtures:record-live            # regenerate all live fixtures (needs Chrome)
pnpm fixtures:record-live wdio-mocha # regenerate one live fixture by id
```

`fixtures:record-live` launches each example in live mode pointed at a reuse-mode
stand-in WS server (`DEVTOOLS_APP_REUSE`), so the adapter streams its events to
the harness instead of booting a backend + opening the DevTools window. It keys
run-end off the worker WS going idle (surviving the mid-run reconnects of
per-scenario runners) and force-kills the runner if it hangs.

### Layer B (visual) — baselines are coupled to the fixtures

`verify:ui` renders each committed `trace.zip` in the player and pixel-diffs the
panels against `visual/baseline/*.png`. The panels draw data baked into the
fixture — console timestamps, network durations + waterfall geometry, the
captured DOM snapshot and a11y tree — so **regenerating a trace fixture
invalidates its visual baselines**. Whenever you run `fixtures:regen`, re-mint
the baselines in the same change:

```sh
rm test/visual/baseline/*.png && pnpm verify:ui   # re-seed, then run again to confirm 54/54
```

Baselines are host-rendered (system Chrome + fonts), so they're a local
maintainer check, not a CI gate — a Linux runner won't match them.

### Layer B (behavioral) — live dashboard

`live-dashboard.e2e.ts` covers what the pixel specs can't: the live dashboard
(`workbench.ts` with `playerMode=false`). `serveLive()` boots the backend live
(no trace) and streams a small synthetic event sequence (`fixtures/live-synthetic.json`)
over the worker WS; the spec then asserts the live wiring — the workbench mounts
in live mode (not the trace player), the testrunner sidebar renders, and
commands/console/network rows stream into the panels. These are DOM assertions
with **no baselines**, so unlike the visual specs they're deterministic across
machines and could gate live mode in CI. A synthetic fixture (not a recording)
because the committed live-events are the non-replayable lite projection and the
raw stream is multi-MB; the dashboard is adapter-agnostic, so one fixture covers
all runners. Pixel-diffing the live dashboard is deliberately skipped — its
panels are the same Lit components the player spec already snapshots.

A fixture that doesn't exist yet skips its entry, so `verify` is green on a fresh
clone until you run `fixtures:regen`. **First run:** after the first
`fixtures:regen`, run `pnpm verify:update` once to write the initial snapshots
(vitest does not auto-create them); thereafter `pnpm verify` checks against them.

## Extending

Add a runner by adding a row to [`capture/matrix.ts`](./capture/matrix.ts):
its `command`, `cleanDirs`, and `traceOutputGlobs`. Nothing else enumerates
adapters. Set `status: 'ready'` once the example produces a trace.

## Status

All six entries are `ready` with committed fixtures — WebdriverIO mocha +
cucumber, Selenium mocha + cucumber, Nightwatch BDD + cucumber — for **both**
Layer A modes: `trace.zip` (capture-parity) and `live-events.json` (live-parity).

Known per-adapter gaps in the *captured data* (not the harness) are tracked in
CLAUDE.md known debt — e.g. nightwatch-cucumber's trace drops DOM mutations and
renders asserts neutral, which live-parity makes visible (its live stream carries
`mutations` + `assert.titleContains`, both absent from its trace summary).
