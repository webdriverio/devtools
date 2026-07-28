# Cross-adapter verification harness

Automates the per-adapter verification that was previously manual: run each
framework's example, open the trace, and eyeball that capture is complete and
the UI renders it. Instead:

- **`pnpm verify`** — Layer A: loads each committed golden `trace.zip` through
  the real backend reader, reduces it to a capture summary, and snapshots it;
  **also** snapshots the live-mode WS stream (`live-events.json`) per adapter.
  Fast, no browser, runs in CI.
- **`pnpm verify:ui`** — Layer B (Phase 2): boots the player against each fixture
  and visual-diffs every panel. Local, needs a browser.
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
│  └─ record-live.ts         record live WS stream via reuse-mode stand-in (browser step)
├─ fixtures/<id>/trace.zip        committed golden trace fixture (one folder per entry)
├─ fixtures/<id>/live-events.json committed golden live projection
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
