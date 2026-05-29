# Architecture

Companion to [CLAUDE.md](./CLAUDE.md). CLAUDE.md defines the **rules**; this file describes **how the pieces fit together** so you can apply those rules without guessing.

If the rules in CLAUDE.md and the descriptions here conflict, CLAUDE.md wins — and one of the files is out of date.

---

## 1. One sentence

A user's test suite is instrumented by a thin framework **adapter**, which sends a normalized event stream through **core** to the **backend**, which broadcasts it over WebSocket to the **app** (a browser UI), with shared types and contracts living in **shared**.

```
[user's test framework]
        │
        ▼
   [adapter]          ◀── thin: hooks + framework specifics
        │
        ▼
     [core]           ◀── all framework-agnostic capture/reporting logic
        │
        ▼ (WS frames typed by shared)
   [backend]          ◀── Fastify + WS gateway + baseline store + runner
        │
        ▼ (WS frames + HTTP, both typed by shared)
     [app]            ◀── Lit UI, framework-agnostic
```

Plus one out-of-band piece: **`packages/script`** is injected into the browser under test (not Node) to capture DOM mutations from the page's own JS context. It talks to the adapter, not directly to backend.

---

## 2. Package responsibilities

> Packages marked **[future]** do not exist yet. Their absence is the highest-priority debt in [CLAUDE.md §7](./CLAUDE.md#7-known-debt).

### `packages/shared`

**Owns:** Types, constants, enums, HTTP/WS contract definitions. Pure TypeScript, no runtime dependencies on other packages in this monorepo. Workspace-internal (`"private": true`) — never published; bundled into each consumer at build time. See [CLAUDE.md §2.6](./CLAUDE.md#26-workspace-internal-packages-must-stay-inlined-at-build-time).

**Contains (target):**
- Domain types: `CommandLog`, `ConsoleLog`, `NetworkRequest`, `Mutation`, `Metadata`, `TestNode`, `TestStatus`, `PreservedAttempt`, `PreservedStep`, etc.
- The `FrameworkId` type: `'wdio' | 'nightwatch' | 'selenium'`.
- HTTP request/response schemas for every backend route.
- WS frame schemas (event name + payload type, for both directions).
- Cross-package constants: API paths, WS scopes, default values, status enums.

**Imports from:** nothing (pure leaf package).

**Imported by:** every other package.

### `packages/core`

**Owns:** All framework-agnostic logic that today is duplicated across adapter packages. Workspace-internal (`"private": true`); inlined into each adapter at build time.

**Contains (target):**
- `SessionCapturer` — orchestrates capture for one test session.
- `ReporterBase` — common reporter behavior (suite/test lifecycle, ID generation, output formatting).
- `generateStableUid()` — single canonical UID generator.
- Console/stream capture — patches `console.*`, intercepts stdout/stderr, strips ANSI, classifies log levels.
- Command-log builder — stack trace parsing, source file loading, sourcemap resolution.
- WS client — connects to the backend, serializes frames per `shared` contracts, handles reconnect.
- Network/performance capture pipeline.
- Sourcemap loader.

**Imports from:** `shared`.

**Imported by:** all adapter packages (`service`, `nightwatch-devtools`, `selenium-devtools`).

### `packages/service` (WebdriverIO adapter)

**Owns:** WebdriverIO-specific glue only.

**Contains (target):**
- WDIO service hooks: `beforeCommand`, `afterCommand`, `beforeTest`, `afterTest`, `beforeSession`, `afterSession`.
- WDIO reporter implementation that extends `core`'s `ReporterBase`.
- WDIO-specific config defaults.
- The launcher entry point (`@wdio/devtools-service`).

**Imports from:** `@wdio/types`, `@wdio/reporter`, `@wdio/logger`, `@wdio/protocols`, `core`, `shared`.

**Must not import:** other adapter packages, `backend`, `app`.

### `packages/nightwatch-devtools` (Nightwatch adapter)

**Owns:** Nightwatch-specific glue only.

**Contains (target):**
- Nightwatch lifecycle hooks (`before`, `cucumberBefore`, `cucumberAfter`, etc.).
- BrowserProxy that wraps Nightwatch's browser API and forwards command events into `core`.
- Nightwatch + Cucumber test discovery.

**Imports from:** `core`, `shared`, `@wdio/logger`.

**Must not import:** other adapter packages, `backend`, `app`.

### `packages/selenium-devtools` (Selenium adapter)

**Owns:** Selenium-specific glue only.

**Contains (target):**
- Driver patching (`driverPatcher.ts`) that wraps `selenium-webdriver`.
- Runner hooks (`runnerHooks.ts`) for Mocha/Jest/Vitest/Cucumber.
- BiDi event handling.

**Imports from:** `core`, `shared`, `selenium-webdriver` (peer).

**Must not import:** other adapter packages, `backend`, `app`.

### `packages/backend`

**Owns:** The server that adapters connect to and the app talks to.

**Contains:**
- Fastify HTTP server.
- WebSocket gateway (one connection per adapter session, one connection per app client).
- Baseline store (in-memory) for preserve-and-rerun.
- Video registry (per-session WebM files).
- Test runner spawner (`runner.ts`) — spawns the user's `wdio` / `nightwatch` / `selenium` binary with rerun filters.

**Framework-awareness:** Only in `runner.ts`, only for building CLI args. Must branch on a typed `FrameworkId` from `shared`, never magic strings.

**Imports from:** `shared`. **Must not import:** any adapter package, `app`, `core` (backend doesn't need core; core is for adapters).

### `packages/app`

**Owns:** The browser UI.

**Contains:**
- Lit web components (sidebar, workbench, compare, console, network, etc.).
- WebSocket client for receiving the live event stream.
- Context providers (`@lit/context`) for the various data streams.
- DataManager-level orchestration (today a single god-file, target: split per concern).

**Imports from:** `shared`. **Must not import:** any adapter package, `backend` directly (only via WS/HTTP), `core`.

### `packages/script`

**Owns:** Browser-injected runtime — runs **inside the page under test**, not in Node.

**Contains:**
- DOM mutation observers.
- Page-side trace collection.
- Communication channel back to the adapter (via the WebDriver bridge).

**Why it's separate:** Different execution environment (browser, not Node). It cannot import from `core` (which assumes Node) or `shared` directly unless `shared` stays strictly browser-safe.

### `examples/wdio/`, `examples/nightwatch/`, `examples/selenium/`

**Owns:** Per-framework demo projects, used for manual verification per [CLAUDE.md §4](./CLAUDE.md#4-testing). Run via `pnpm demo:wdio` / `pnpm demo:nightwatch` / `pnpm demo:selenium` from the repo root. Selenium has multiple runners (`mocha-test/`, `jest-test/`, `cucumber-test/`); the default `demo:selenium` script runs mocha, and `selenium-devtools` exposes per-runner variants via `pnpm --filter @wdio/selenium-devtools example:<runner>`.

---

## 3. Data flow

### A test run, end to end

1. User runs `wdio` / `nightwatch test` / `mocha + selenium` — their normal command.
2. The framework loads its adapter (via service/plugin config).
3. Adapter calls `core.startSession()`, which:
   - Spawns a connection to `backend` over WS.
   - Patches `console.*`, stdout, stderr.
   - Installs sourcemap loader.
4. Framework fires lifecycle hooks (suite start, test start, command, etc.). Adapter translates each hook into a `core` call.
5. `core` builds the typed event (per `shared` schema) and sends it through the WS client.
6. `backend` receives, optionally persists (baseline store, video registry), and broadcasts to all connected `app` clients.
7. `app` updates its Lit components reactively.

### Preserve-and-rerun

1. User clicks the bug-play icon on a failed test in `app`.
2. `app` POSTs to `/api/baseline/preserve` (typed contract in `shared`).
3. `backend` snapshots the failing attempt into the baseline store, then spawns a rerun via `runner.ts`.
4. The rerun goes through the normal flow above.
5. `app` receives both attempts and renders the side-by-side compare view.

### Rerun mechanics (framework-specific, but contained)

`backend/src/runner.ts` is the **only** place outside an adapter that knows about specific frameworks. It branches on `FrameworkId` to build:
- WDIO: `wdio run config.ts --spec <file>` or `--mochaOpts.grep`.
- Nightwatch: `nightwatch <file>` or `--cucumberOpts.name <pattern>`.
- Selenium + Mocha/Jest/etc.: depends on detected runner.

Every other piece of the system sees only normalized events.

---

## 4. Boundaries and contracts

Every place data crosses a package boundary, there must be a typed contract in `shared`. The boundaries are:

| Boundary | Direction | Transport | Contract lives in |
|---|---|---|---|
| Adapter → backend | One-way events (command, console, mutation, etc.) | WebSocket frames | `shared/ws-frames.ts` |
| App → backend | API requests (preserve, clear, get baseline, run, stop) | HTTP (Fastify) | `shared/api-routes.ts` |
| Backend → app | Live event broadcast + API responses | WebSocket + HTTP | `shared/ws-frames.ts`, `shared/api-routes.ts` |
| Script → adapter | Mutation events from the page | Via WebDriver bridge (executeScript + log channel) | `shared/script-protocol.ts` |

A new boundary contract is a `shared` change. Adding a new event type or HTTP route without updating `shared` is a CLAUDE.md §2.5 violation.

---

## 5. Where do I add new code?

A decision tree for the most common cases. Answer top-down — the first match wins.

**Are you adding or changing a type, constant, enum, schema, or contract used by more than one package?**
→ `packages/shared`.

**Are you adding logic that captures, parses, normalizes, formats, or transports test-event data, and it doesn't depend on a specific framework's API?**
→ `packages/core`. Create it if it doesn't exist.

**Are you wiring a specific framework's hook, event, or driver to the event pipeline?**
→ The matching adapter package. Adapter code should call `core` for the actual work and only own the hook registration.

**Are you adding a backend HTTP route, WS handler, or runner behavior?**
→ `packages/backend`. Add the contract to `shared` first.

**Are you adding UI?**
→ `packages/app`. Consume contracts from `shared` only; never reach into adapter or backend internals.

**Are you adding code that runs inside the browser under test (DOM observer, page-side hook)?**
→ `packages/script`.

**You're still not sure.**
→ Ask. Ambiguity here is the most expensive kind of mistake — putting something in the wrong package now means migrating it later, and migrations across this many consumers are painful.

---

## 6. Current reality vs. target

This is a snapshot of where the codebase diverges from the architecture above. As debt is resolved, update this section **and** delete the matching entry from [CLAUDE.md §7](./CLAUDE.md#7-known-debt).

### Populated packages and what's still in adapters
- `packages/shared` contains baseline API constants, `TestRunnerId`, and the core test-event types (`CommandLog`, `ConsoleLog`, `NetworkRequest`, `Metadata`, `TraceLog`, `TraceType`, `PreservedAttempt`, `PreservedStep`, `TestStatus`, `TestError`, `PerformanceData`, `DocumentInfo`, `Viewport`, `ScreencastInfo`, `LogLevel`). Adapter `types.ts` files re-export shared types for backwards compatibility.
- `packages/core` contains console-capture constants and pure helpers (`CONSOLE_METHODS`, `ANSI_REGEX`, `LOG_LEVEL_PATTERNS`, `LOG_SOURCES`, `ERROR_INDICATORS`, `stripAnsi`, `detectLogLevel`, `createConsoleLogEntry`) and stable-UID helpers (`generateStableUid`, `deterministicUid`, `resetSignatureCounters`). The full `SessionCapturer` class, `#patchConsole`/`#patchStreams` instance logic, command-log builder, reporter base, sourcemap loader, and WS client are still in adapters and duplicated 3 ways.

### Misplaced logic
- `packages/service` currently contains framework-agnostic logic (UID generation, console capture, sourcemap resolution, reporter base) that belongs in `core`. The other two adapters re-implement the same logic instead of importing it.

### Misplaced state and concerns
- `packages/app/src/controller/DataManager.ts` (~986 lines) bundles WS connection, 11 context providers, business logic, and baseline coordination into one file. Target: one module per concern behind a thin façade.
- `packages/app/src/components/sidebar/explorer.ts` (~670 lines) is a Lit component that also makes HTTP calls — UI and I/O mixed.
- `packages/app/src/components/workbench/compare.ts` (~888 lines) mixes data fetching, diff logic, popup window management, and rendering.
- `packages/backend/src/index.ts` (~387 lines) bundles server wiring, WS gateway, video registry, baseline API, and runner lifecycle.

### Missing contracts
- App-to-backend `fetch()` calls have no shared request/response types.
- The reporter in `packages/service/src/reporter.ts` uses `as any` for inputs instead of typed shapes.

---

## 7. Migration order (suggested)

Not a hard sequence — just the order that minimizes churn. Each step is intended to be one or a small handful of PRs, not a giant rewrite.

1. ~~**Create `packages/shared`.** Empty workspace package with proper `package.json`, `tsconfig`, exports.~~ ✅ Done.
2. ~~**Move duplicated cross-package types into `shared`.**~~ ✅ Done for the 6 app-imported types and their dependencies.
3. ~~**Move duplicated constants and status types into `shared`.**~~ ✅ Done. `BASELINE_API`, `BASELINE_WS_SCOPE`, `TestStatus`, `TestRunnerId` all live in shared. Sidebar `TestState` is a value-only enum-style accessor backed by `TestStatus`.
4. ~~**Create `packages/core`.**~~ ✅ Done.
5. ~~**Extract one duplicated logic block into `core`.**~~ ✅ Done for pure console helpers and UID helpers (constants, `stripAnsi`, `detectLogLevel`, `createConsoleLogEntry`, `generateStableUid`, `deterministicUid`, `resetSignatureCounters`). The `SessionCapturer` class itself still owns the patching logic in each adapter.
6. **Continue extracting `SessionCapturer`, command-log builder, reporter base, sourcemap loader, WS client into `core`.** One per PR. `SessionCapturer` is the biggest — it ties together console patching, stream wrapping, and the upstream WS, and needs a clean hybrid base-class API so each adapter can hook its own session state. **See [`SESSIONCAPTURER_EXTRACTION_PLAN.md`](./SESSIONCAPTURER_EXTRACTION_PLAN.md) for the staged plan, design questions, migration order, and verification steps.**
7. **Type the HTTP/WS contracts in `shared`.** Backend and app start importing them at the boundary.
8. ~~**Replace string-based framework checks in `runner.ts` with `FrameworkId`.**~~ ✅ Done via `TestRunnerId` in shared (typed `FRAMEWORK_FILTERS` map key).
9. **Split god-files opportunistically as their sections are edited** (boy-scout rule from CLAUDE.md §5).

Steps 1–3 alone resolve roughly half of the known debt and unlock the rest. Steps 5–6 are where the per-feature productivity gains compound — once console capture is in core, the next feature touching console logs is one change instead of three.
