# Cross-adapter verification harness

Automates the per-adapter verification that was previously manual: run each
framework's example, open the trace, and eyeball that capture is complete and
the UI renders it. Instead:

- **`pnpm verify`** — Layer A: loads each committed golden `trace.zip` through
  the real backend reader, reduces it to a capture summary, and snapshots it.
  Fast, no browser, runs in CI.
- **`pnpm verify:ui`** — Layer B (Phase 2): boots the player against each fixture
  and visual-diffs every panel. Local, needs a browser.
- **`pnpm fixtures:regen`** — the one browser step: re-runs the examples in trace
  mode and refreshes the committed fixtures.

## Layout

```
test/
├─ capture/
│  ├─ matrix.ts              entry table (adapters × runners) — the only file that knows adapters
│  ├─ summarize.ts           trace → deterministic capture summary (the snapshotted value)
│  ├─ capture-parity.test.ts expect(summarize(trace)).toMatchSnapshot() per entry
│  └─ __snapshots__/         committed golden summaries
├─ support/
│  ├─ paths.ts               repo/test roots + fixture paths
│  └─ find-zip.ts            newest-zip finder (used by regen)
├─ fixtures/<id>/trace.zip   committed golden fixtures (one folder per entry)
├─ regen.ts                  regenerate fixtures (browser step)
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
pnpm verify                    # Layer A — snapshot check (no browser)
pnpm verify:watch              # watch mode
pnpm verify:update             # seed/accept snapshots after a regen (vitest -u)
pnpm fixtures:regen            # regenerate all ready fixtures (needs Chrome)
pnpm fixtures:regen wdio-mocha # regenerate one entry by id
```

A fixture that doesn't exist yet skips its entry, so `verify` is green on a fresh
clone until you run `fixtures:regen`. **First run:** after the first
`fixtures:regen`, run `pnpm verify:update` once to write the initial snapshots
(vitest does not auto-create them); thereafter `pnpm verify` checks against them.

## Extending

Add a runner by adding a row to [`capture/matrix.ts`](./capture/matrix.ts):
its `command`, `cleanDirs`, and `traceOutputGlobs`. Nothing else enumerates
adapters. Set `status: 'ready'` once the example produces a trace.

## Status

Five entries are `ready` with committed fixtures: WebdriverIO mocha + cucumber,
Selenium mocha + cucumber, Nightwatch BDD.

`nightwatch-cucumber` has a working example (it runs and captures per-scenario in
trace mode) but is `planned` — a **documented limitation**: Nightwatch's cucumber
runner uses a browser session per scenario, so the adapter's session-scoped trace
export (written once at run-end) has no single live session to finalize and writes
no `trace.zip`. The harness surfaced it; it's tracked in CLAUDE.md known debt.
Flip to `ready` once `@wdio/nightwatch-devtools` supports per-scenario trace writing.
