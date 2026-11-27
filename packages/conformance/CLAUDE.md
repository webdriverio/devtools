# packages/conformance — design notes and known debt

Conformance suite (`packages/conformance`): scenario comparison, the KNOWN_GAPS allowlist, smoke expectations and the hosted-player check.

## Commands

| Command | What it does |
|---|---|
| `pnpm smoke:assert --expect <name> [--exit-code N] [--log file] <zip-or-dir>...` | Check trace zips against `packages/conformance/smoke/expectations/<name>.json`: the listed rows under each test's own tracing group (or the whole run for an entry with `scope: "run"` and a `reason`), an error row on each deliberately failing test, a retried test's attempt count with its other checks read from its final attempt alone (`attempts`), title fragments such as a failed wait's condition, a call site on every row of a per-test entry (at least one for a run-scoped entry) and every call site inside the example's own `sourceFiles`, the run's exit code, no wait timeout, in any adapter's wording (`TIMEOUT_PATTERNS` in `smoke/constants.ts`), in the trace's stdout or the run log other than the lines of a test marked `allowTimeoutError`, and the zips' combined size against the file's required `traceBudget.maxBytes`. |
| `pnpm player:e2e [--headed] [--port N]` | Build the hosted trace player, serve it under the `vercel.json` headers and open trace zips through it in headless Chrome with WebdriverIO (`packages/conformance/hosted-player/`). `pnpm exec tsx packages/conformance/hosted-player/run.ts --url <player>` runs the same check against a deployed page without building. |

## Known debt

`tests/known-debt.test.ts` requires every `KNOWN_DEBT` reason in `src/constants.ts` to quote an entry as `Known debt: "<text>"`, and this file to hold a bold `**<text>` entry for it. Every scoped `KNOWN_GAPS` reason must be one of those `KNOWN_DEBT` values.

- **What the conformance scenario shows the adapters doing differently.** Each entry is a `KNOWN_GAPS` reason in `packages/conformance/src/allowlist.ts`, scoped to the differences it explains. It is reported stale once it stops occurring, except a `timingDependent` entry, which is never reported stale and must be removed by hand.
  - **Only the WebdriverIO service shows an element wait's polls** (#464). The service nests the `isExisting` polls of `waitForExist`/`waitForDisplayed` under the wait. Nightwatch's `waitForElement*` polls through its own transport, and Selenium and Python element waits poll with `findElement(s)`, which ACTION_MAP leaves unmapped. Those polls are live but absent from the trace, so adapters differ inside each element wait and nowhere else.
