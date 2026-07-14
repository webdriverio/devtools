# Repo conventions

This file describes the conventions in place across the devtools monorepo — how code is organized, how packages relate to each other, how tests are structured, and what the coding style looks like. It's the companion to [ARCHITECTURE.md](./ARCHITECTURE.md): that file says where the pieces are; this one says why they're shaped the way they are and what to look for when adding or changing code.

Anyone working in the repo, human or AI agent, can use this as the source of truth for "how do we do things here."

---

## What this repo is

A devtools dashboard for end-to-end browser tests. Three test frameworks (WebdriverIO, Nightwatch, Selenium) push the same normalized event stream through a single backend into a single Lit-based browser UI. The adapters are deliberately thin — they translate framework hooks into calls on a shared core capture/reporting library and own only the framework-specific glue.

Package map and data flow are in [ARCHITECTURE.md](./ARCHITECTURE.md). The summary: `shared` for types and contracts, `core` for framework-agnostic capture, three adapters (`service`, `nightwatch-devtools`, `selenium-devtools`) for framework glue, `backend` for the server, `app` for the UI, `script` for the page-injected runtime.

---

## Commands

Run from repo root unless noted.

| Command | What it does |
|---|---|
| `pnpm install` | Install workspace dependencies. |
| `pnpm build` | Build all packages (`pnpm -r build`). |
| `pnpm test` | Run vitest suite once. |
| `pnpm test:watch` | Run vitest in watch mode. |
| `pnpm test:coverage` | Run vitest with v8 coverage. The thresholds in `vitest.config.ts` are the floor — drops fail CI. |
| `pnpm lint` | Lint all packages in parallel. Includes `eslint-plugin-security` for a subset of CodeQL findings; deeper taint-flow checks surface on the PR's CodeQL scan. |
| `pnpm demo:wdio` / `pnpm demo:nightwatch` / `pnpm demo:selenium` | Run the per-framework example projects. Useful for manual verification of UI or runtime changes. |
| `pnpm dev` | Run all packages in parallel dev mode. |

`selenium-devtools` exposes per-runner variants of its example via `pnpm --filter @wdio/selenium-devtools example:mocha` / `:jest` / `:cucumber` / `:jasmine` / `:vitest`.

---

## Path aliases

Defined in root `tsconfig.json`:

| Alias | Resolves to |
|---|---|
| `@/*` | `packages/app/src/*` |
| `@components/*` | `packages/app/src/components/*` |
| `@core/*` | `packages/app/src/core/*` (app-internal — not the framework-agnostic `packages/core`) |
| `@wdio/devtools-backend` / `*` | `packages/backend/src/...` |
| `@wdio/devtools-script` / `*` | `packages/script/src/...` |
| `@wdio/devtools-service` / `*` | `packages/service/src/...` |
| `@wdio/selenium-devtools` / `*` | `packages/selenium-devtools/src/...` |
| `@wdio/devtools-shared` / `*` | `packages/shared/src/...` |
| `@wdio/devtools-core` / `*` | `packages/core/src/...` |

These exist so imports stay short and grep-able. Long relative paths (`../../../components/…`) aren't used.

The `@core/*` name is a historical alias for app-internal helpers and predates `packages/core`. They don't collide because they resolve to different roots, but the names are confusable.

---

## Conventions

### One source of truth per concept

Every shared type, constant, enum, schema, and HTTP/WS contract lives in `packages/shared`. Adapter packages and the app never re-declare a concept that already exists upstream — they re-export shared definitions when a local consumer name needs to stay stable (e.g. nightwatch's `TEST_FILE_PATTERN` is `export { SPEC_FILE_RE as TEST_FILE_PATTERN } from '@wdio/devtools-shared'`).

When a duplicate is discovered, the next change that touches either copy consolidates them into shared.

### Framework-agnostic logic lives in `core`

Anything that captures, parses, normalizes, formats, or transports test-event data and doesn't depend on a specific framework's API lives in `packages/core`. Adapters call into core; they don't reimplement.

If the same logical change would land in two or more adapters, the logic belongs in core. This rule produced the current `SessionCapturerBase`, `TestReporterBase`, `ScreencastRecorderBase`, `resolveAdapterOutputDir`, and the pure helpers around console capture, error serialization, UID generation, stack-trace parsing, BiDi attachment, and screencast finalization.

Some helpers are framework-agnostic by nature but used in only one adapter today (e.g. nightwatch's `parseNetworkFromPerfLogs` for CDP perf-log parsing, selenium's `detectRunner`/`captureLaunchCommand`). They stay in their adapter until a second consumer appears; at that point they move to core.

### Adapters are thin and isolated

Adapter packages own only:

- Framework-specific hook registration and lifecycle binding.
- Framework-specific driver/browser patching.
- Framework-specific config and capabilities.

They import from `shared` and `core`, never from each other. They aren't imported by `backend` or `app`.

### Backend and app are framework-agnostic

`backend` and `app` import from `shared` only (for contracts) and from each other via the WS/HTTP boundary. Neither imports an adapter package.

Framework-specific behavior in the backend is contained in two files: `runner.ts` and `framework-filters.ts`. Both branch on a typed `TestRunnerId` from shared, never on a magic string. The `framework-filters` dispatch is a `switch` over `TestRunnerId` (not a table lookup) so CodeQL's `unvalidated-dynamic-method-call` query trusts the call site.

### Boundaries have typed contracts

Every `fetch(...)` and `ws.send(...)` has a typed request/response shape in shared. `SocketMessage<T extends WsMessageScope>` is the canonical WS wire format — receivers narrow on `scope` to get the exact payload type per branch.

No `any` crosses a package boundary. When a framework API forces a loosely-typed value (Nightwatch's `currentTest`, Selenium's BiDi events, raw HTTP payloads), the `any` is cast to a typed shape immediately at the boundary, with the cast site documenting why.

### Workspace-internal packages stay bundled

`packages/shared` and `packages/core` are `"private": true` and never published. Each consumer inlines their code into its own `dist/` at build time.

- Both deps are listed in `devDependencies` with `workspace:^`, never in `dependencies`. Vite and tsup both externalize anything in `dependencies` by default; `devDependencies` is what gets inlined.
- Neither is added to a bundler's `external` config. Vite's `external` callback receives both the bare package name *and* the resolved absolute path (e.g. `/Users/.../packages/core/src/index.ts`); a check for only one form silently externalizes the other.
- The same callback receives bare relative imports (`./utils.js`, `../constants.js`). A check that allows only `./` will externalize `../`-style imports from subfolders and the dist crashes with `ERR_MODULE_NOT_FOUND` at install time.
- `packages/service/vite.config.ts` is the canonical pattern for getting both right.
- After any change to a bundler config or build script, `grep -E "@wdio/devtools-(core|shared)|/packages/(core|shared)/" packages/<pkg>/dist/*.js` should return nothing. That's how you catch the absolute-path leak.

Bundlers in use: **vite** for `app`, `service`, `script`; **tsup** for `backend`, `nightwatch-devtools`, `selenium-devtools`.

### Separation of concerns within a file

Files own one concern:

- UI components render. They don't `fetch`, manage WebSocket state, or run business logic.
- Controllers and services own I/O and state. They don't render.
- Backend route handlers wire requests to services. They don't contain business logic inline.
- Reporters report. They don't also resolve sourcemaps, read files, and generate step UIDs in the same module.

Mixed-concern files are split as they're touched. The app-side helpers like `contextUpdates.ts`, `runnerCapabilities.ts`, `renderDetailBlock.ts`, `compareUtils.ts`, `suite-merge.ts`, `mark-running.ts`, `run-detection.ts`, and `stepResolution.ts` are all extractions from larger god-files.

### TypeScript

- `strict: true` is on (root `tsconfig.json`).
- No `any`. If a framework or library forces it, the `any` is isolated at the boundary and cast to a typed shape with a one-line comment explaining why. As of writing, there are no `no-explicit-any` warnings repo-wide.
- No `as unknown as X` double-casts unless the reason is documented inline.
- `type` for unions, `interface` for object shapes that may be extended.
- Names exported from `shared` and `core` are public API of those packages — renames are breaking changes for downstream consumers.

### Naming

- One name per concept across the whole repo. The canonical test-status name is `TestStatus` in shared; the sidebar `TestState` is a value-only enum-style accessor over the same string union.
- Constants are `SCREAMING_SNAKE_CASE`. Types are `PascalCase`. Functions and variables are `camelCase`. Files are `kebab-case.ts` unless they match a class name (`SessionCapturer.ts`).

### File and function size

Soft caps (warnings in `pnpm lint`, not errors):

- **File**: 500 logic lines (blank lines and comments excluded). Files growing toward this cap are split as their sections are edited.
- **Function**: 50 logic lines.

A few declarative blocks (`#getInternals` accessor bags in the adapter plugins) exceed the function cap intentionally — splitting them artificially hurts readability. Those are marked with an inline `eslint-disable-next-line max-lines-per-function` plus a one-line justification.

### Comments

- Default to no comments. Names should explain *what*.
- A comment is written only when the *why* is non-obvious: a hidden constraint, a workaround for a specific bug, a subtle invariant, behavior that would surprise a reader.
- `// TODO`, `// added for X`, `// removed Y`, `// keep in sync` aren't used — the first three belong in git history; the fourth means a single source of truth is missing.
- One line max. Multi-paragraph docstrings aren't used.

### Error handling

- Validation happens at boundaries (HTTP input, WS messages, framework callbacks). Internal code is trusted.
- Errors aren't swallowed silently. `catch` only adds context, then rethrows or logs with enough detail to debug. Empty catches don't appear in production code.

### Dead code

Unused exports, unused imports, commented-out blocks, and `_unused` parameters get deleted when discovered. Git history is the safety net for "in case we need it later" code.

---

## Testing

The repo uses **vitest** at the root. The current state: 566 tests across 47 files; thresholds at `vitest.config.ts` enforce a floor of 85/77/86/85 (statements/branches/functions/lines). Coverage is ratcheted upward as gaps close, never downward.

### What gets tested

- **`shared` and `core`**: unit tests for every exported function and type guard. These are the foundation; regressions cascade.
- **Bug fixes (any package)**: a regression test that fails before the fix and passes after. When a real test is genuinely impossible (e.g. requires a live browser the infra doesn't have), the PR description says so.
- **New HTTP/WS contracts**: a test that exercises the contract end-to-end at least once.

### Adapter and backend logic

Non-trivial parsing or transformation logic in adapters has unit tests. Hook wiring is verified manually via `examples/<framework>/`. `backend` and `app` test their non-UI logic (parsers, transforms, state reducers); UI verification is manual.

### Manual verification

For UI or runtime changes, `examples/<framework>/` is the verification harness. Type-checks and unit tests verify code correctness, not feature correctness — claiming a UI change works on the basis of `tsc --noEmit` alone misses the point.

When CI can't run an example (no real browser), the PR description says so explicitly.

### Skipping tests that depend on workspace-internal build artifacts

A handful of tests need `@wdio/devtools-script` to be built first (the browser-injected bundle). CI test jobs sometimes run before that build step; those tests gate on `it.skipIf` after probing `createRequire(import.meta.url).resolve('@wdio/devtools-script')`. Locally they run normally.

---

## Workflow

### When adding code

The decision tree from [ARCHITECTURE.md "Where things live"](./ARCHITECTURE.md#where-things-live) is the starting point. The general shape:

- Shared concept → `shared`.
- Framework-agnostic capture/reporting logic → `core`.
- Framework-specific glue → the matching adapter.
- Server route/WS handler → `backend` (contract in `shared` first).
- UI → `app`.
- Code that runs in the browser under test → `script`.

When the right place is ambiguous (something between `shared` and `core`, or between `core` and an adapter), the question that resolves it is: *who else would want this?* If the answer is "any future adapter would," it's `core`. If "only the framework with X-specific API does," it's the adapter.

### While editing

- Boy-scout rule applies: when touching a file or section, leave it more aligned with these conventions than it was found. Touch a duplicated type, consolidate it into shared. Touch a section of a god-file, split that section out. Touch a magic-string framework check, replace it with `TestRunnerId`. The cleanup scope matches the change scope — don't rewrite the whole file, but don't leave a clear convention violation in lines just touched.
- New code doesn't introduce violations to match existing style. Where existing style violates these conventions, that's documented debt (§ Known debt), not a template.

### Before pushing

- `pnpm build`, `pnpm test`, `pnpm lint`. Don't push red.
- For UI or runtime changes: verify in `examples/<framework>/`.
- Deeper security findings (taint flow, polynomial-redos with adjacent quantifiers) surface on the PR's CodeQL scan; review and fix those before merge.

### Commits

- Small, focused. Don't bundle unrelated changes.
- Imperative mood. The commit message explains *why*; the diff shows *what*.
- New commits, not amends to pushed/shared commits.
- No `--no-verify` to skip hooks. If a hook fails, the underlying issue gets fixed.

### PRs

- One concern per PR. A refactor and a feature are two PRs.
- A PR touching more than one adapter package answers in its description: *why isn't this in `core`?*

### Documentation

- User-facing docs live in two places that must stay in sync: this repo's `README.md` (+ per-package READMEs) and the **WebdriverIO devtools webpage** (`website/docs/devtools/**` in the `webdriverio/webdriverio` repo — e.g. `wdio/TraceMode.md`). When a change adds, removes, or alters user-facing behavior (a new option, CLI, flag, output, or workflow), update the README here **and** mirror it to the matching webpage doc in the same change. A docs PR that updates only one side isn't complete.

---

## Known debt

Documented divergences from the conventions above. They exist today as debt to be paid down, not exceptions to the rules. Each change reduces this list; new violations don't get added.

### Architecture

- `replaceCommand` has two semantics — Selenium mutates in place (preserves `_id`/`id` for chained calls); Nightwatch splices and reissues. Both call the same `core/suite-helpers` factories; the storage strategy stays adapter-specific because runner integrations differ. Could be unified by parameterizing the policy if the divergence ever causes a real problem.
- `patchNodeAssert` (via `core/assert-patcher`) is now wired in all three adapters, default-on behind each adapter's `captureAssertions` option (opt out with `captureAssertions: false`). Framework matcher libraries differ: Service taps expect-webdriverio's `beforeAssertion`/`afterAssertion` hooks so passing+failing matchers render as `expect.*` actions (mechanism in the assert-capture entry below); Nightwatch native `assert`/`verify` and Selenium's `node:assert` also surface passing+failing rows via their reconcile/patch paths. The remaining gap is Selenium's jest-style `expect()` (and chai): jest/vitest expose no pass+fail assertion hook, so only failing matchers surface there.
- BiDi is auto-attached in Service and Selenium; Nightwatch is opt-in via `bidi: true` and requires `webSocketUrl: true` in capabilities.
- Retry-aware trace policies share one mechanism: adapters feed a per-attempt **outcome ledger** (`core/attempt-tracker.ts` `TestAttemptTracker.recordStart(uid, specFile)` + `recordOutcome(uid, state, attempt)`) keyed by the **retry-stable** uid, and the finalizer reads the scoped views (`all`/`forSpec`/`forTest`) so `trace-retention.ts` evaluates **group-by-test** — `retain-on-failure` keys on each test's *final* attempt (no over-retaining a fail-then-pass), `retain-on-first-failure` on *attempt 0*. `recordStart` on a second attempt stamps the prior attempt `failed` (a retry only follows a failure), which corrects runners that swallow the intermediate failure — e.g. Mocha via a `--require` plugin never surfaces the retried attempt's failure, so the ledger would otherwise see `[passed, passed]`. An empty scoped view falls back to `testMetadata` (never fail-open-retains).
  - **WDIO + Selenium: verified end-to-end** (manual fail-then-pass runs: retained under `retain-on-first-failure`, dropped under `retain-on-failure`).
  - **Nightwatch: `retain-on-failure` works; the other retry-aware policies degrade.** Its `--retries` re-runs the testcase *internally* without re-firing the plugin's per-test hooks, and the per-testcase results carry no attempt/retry field (retries live only in undocumented, version-varying Nightwatch internals — `suiteRetries.testRetriesCount` / `reporter.testResults.retryTest`), so the ledger sees only the final attempt for the `describe/it` and exports-object interfaces. Cucumber scenarios expose per-scenario hooks, so the feed captures their attempts. Not cleanly fixable without depending on those internals.
  - WDIO `specFileRetries` spawns a fresh worker per retry, so cross-process attempts aren't in the (process-scoped) ledger.
- Eager per-test trace slice (Nightwatch + Selenium) can drop an action snapshot whose fire-and-forget capture hasn't resolved by `afterEach` / scenario end — the slice is written from whatever snapshots exist at flush time. The WDIO service is immune because it awaits each snapshot inline before flushing.
- Nightwatch native asserts are buffered at call time and emitted in one batch at test-end (Nightwatch exposes no per-assertion execution/outcome hook reachable from the plugin — `client.queue.tree` / `client.reporter` aren't on `browser`). Streaming mid-run would flash every assert green before its outcome is known, so rows are held and reconciled against `results.testcases[*].assertions` at `afterEach` (the flat `results.assertions` only reflects the last testcase). The exporter re-sorts commands by timestamp (`buildActionEvents`) so the batched rows land at their real timeline positions rather than clustering at flush time. `actual` is parsed from the failure message (`but got: …`, failures only) into a collapsed `{passed, expected, actual}` result; `expected` is the assertion arg — the label still mirrors the call args, not the derived values.
- Nightwatch's BDD `describe/it` interface fires the plugin's global `beforeEach`/`afterEach` **once per module** (with an empty `currentTest.name`), not per `it` — Nightwatch runs the individual `it`s internally with no per-testcase hook or event reachable from the plugin (the lib emits only transport-level events). So `traceGranularity:'test'` records a single slice boundary (the first test) and collapses to one session-scoped slice; retry-aware/per-test retention (`tracePolicy`) degrades to session scope for this interface. Per-test slicing works for adapters/styles that expose per-test hooks (WDIO mocha/cucumber, Selenium mocha; likely Nightwatch's exports-object style, unverified). Session-granularity trace is unaffected.
- Service renders expect-webdriverio matchers as single `expect.<matcher>` rows by **folding**, not stack/depth suppression (the old `#assertionDepth`/`#matcherStarted`/self-heal machinery is gone). The matcher's value-read (`toHaveText`→`getText`, `toExist`→`isExisting`, …) is captured as a normal command; `afterAssertion` then coalesces the synthesized `expect.*` row into that read in place — inheriting its callSource, screenshot, and timeline position — and the fold replaces **by timestamp, never a public `id`**: `id` is the per-worker `commandCounter`, which resets per spec, so stamping one lets the app's id-first `replaceCommand` swap a same-id row from another spec (duplicate rows + a fold from another spec vanishing, in multi-spec live mode). `beforeAssertion` arms the pending matcher (depth-counted so aliases like `toBeChecked`→`toBeSelected` fold once); a matcher that **hard-throws** — element never resolves, so expect-webdriverio's `waitUntil` rethrows and `afterAssertion` never fires — is synthesized at `afterTest`/`afterStep` from the throwing read, so a failing assertion renders as `expect.<matcher>` whether or not the element existed. Two limits: its error is then the read's (`Can't call getText on … element wasn't found`), not an assertion-phrased message; and `MATCHER_READ_COMMANDS` is a hand-maintained allowlist, so a matcher whose read isn't listed leaves its raw read visible alongside the `expect.*` row. Plain-value jest matchers (`expect(x).toBe(y)`) don't fire the ewdio hooks, so they aren't captured as rows.

### File-size (raw line counts; soft cap is 500 logic lines)

Most entries below don't trigger the `max-lines` lint rule after `skipBlankLines`/`skipComments`; they're documented because their raw line count is over 500, and the next substantive change to any of them should still look for an extraction opportunity. The service plugin is the exception — it's now over the *logic*-line cap.

- `packages/service/src/index.ts` — over the 500-**logic**-line soft cap and ~620 raw (the WDIO plugin god-file: session/screencast/command/assertion/trace-slice wiring in one class). The assertion-capture block (`beforeAssertion`/`afterAssertion`/`#handleAssertionOutcome`/`#finalizePendingAssertion`, plus the `#assertionDepth`/`#pendingAssertion` state) is now the largest self-contained seam and the prime extraction candidate; trace-slice and screencast are the next two.

- `packages/nightwatch-devtools/src/index.ts` (~536 raw). Cucumber/test/run-lifecycle, session-init, event-hub modules already extracted; remainder is the `PluginInternals` accessor bag plus per-method delegators plus the factory. Accept-as-is.
- `packages/selenium-devtools/src/index.ts` (~560 raw). Session/test-lifecycle extracted; remainder is the `PluginInternals` accessor bag plus onCommand/onDriverCreated wiring. Same situation as nightwatch.
- `packages/nightwatch-devtools/src/session.ts` (~468). `captureNetworkFromPerformanceLogs` + `captureBrowserLogs` + `captureTrace` are tightly coupled to NightwatchBrowser state. Coverage at 78% after recent backfill; further extraction would need rewriting the browser-coupling.

### Test coverage gaps (worst-risk-first)

Numbers reflect actual `pnpm test:coverage` output.

- `packages/selenium-devtools/src/session.ts` — **83%**. Remaining branches are inside http-error / no-such-session paths that need a real driver to exercise.
- `packages/nightwatch-devtools/src/session.ts` — **78%**. `takeScreenshotViaHttp` error branches need real WebDriver.
- `packages/service/src/screencast.ts` — **76%**. CDP fast-path branches hard to exercise without a real Chrome.
- `packages/backend/src/baselineStore.ts` — **91%**. Remaining 9% is leaf-error paths.

The threshold gate in `vitest.config.ts` enforces the current floor — it ratchets upward as gaps close, never downward.

### Type-safety

No known violations. New ones get tracked here as discovered.

---

## Living document

This file evolves with the repo. When a convention turns out to be wrong in practice, the right fix is to update the convention, not to silently break it. When a recurring decision point isn't covered here, it gets added.
