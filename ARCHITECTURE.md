# Architecture

A descriptive map of how the pieces fit together. For conventions and coding standards, see [CLAUDE.md](./CLAUDE.md).

---

## At a glance

A devtools dashboard for end-to-end browser tests. Three test frameworks (WebdriverIO, Nightwatch, Selenium) push the same normalized event stream through a single backend into a single browser UI.

```
[user's test framework]
        │
        ▼
   [adapter]          thin: framework-specific hooks + driver patching
        │
        ▼
     [core]           framework-agnostic capture/reporting library
        │
        ▼ (WS frames typed by shared)
   [backend]          Fastify + WS gateway + baseline store + rerun spawner
        │
        ▼ (WS + HTTP, both typed by shared)
     [app]            Lit browser UI, framework-agnostic
```

A separate piece, **`packages/script`**, is injected into the browser under test (not Node) to capture DOM mutations from the page's own JS context. It communicates back through the adapter, not directly to the backend.

---

## Packages

The workspace is a pnpm monorepo. Two of the packages (`shared`, `core`) are workspace-internal — they're marked `"private": true` and never published; consumers bundle their code into their own `dist/`.

### `packages/shared`

Types, constants, enums, HTTP/WS contract definitions. Pure TypeScript, no runtime dependencies on any other package in the monorepo. Workspace-internal; inlined into every consumer at build time.

Contains the canonical definitions for:

- Domain types: `CommandLog`, `ConsoleLog`, `NetworkRequest`, `TraceMutation`, `Metadata`, `TraceLog`, `TraceType`, `TestStats`, `SuiteStats`, `TestStatus`, `TestError`, `ReporterError`, `PreservedAttempt`, `PreservedStep`, `PerformanceData`, `DocumentInfo`, `Viewport`, `ScreencastInfo`, `ScreencastFrame`, `ScreencastOptions`, `LogLevel`, `LogSource`.
- WS wire format: `SocketMessage<T>`, `WsMessageScope`, `WsPayloadFor<T>`, `ClearExecutionDataWsPayload`, `ReplaceCommandWsPayload`.
- Routing/scope constants: `WS_PATHS`, `WS_SCOPE`, `BASELINE_WS_SCOPE`, `TESTS_API`, `BASELINE_API`.
- Process-control env vars: `REUSE_ENV`, `RUNNER_ENV`.
- Defaults: `TIMING_BASE`, `DEFAULTS_BASE`, `SCREENCAST_DEFAULTS`.
- File patterns: `SPEC_FILE_RE`, `FEATURE_FILE_RE` (the latter Cucumber-only).
- Test-runner identification: `TestRunnerId = 'mocha' | 'jasmine' | 'cucumber' | 'nightwatch' | 'nightwatch-cucumber' | 'selenium-webdriver'`.

Imports from: nothing. Imported by: every other package.

### `packages/core`

Framework-agnostic capture and reporting library. Workspace-internal; inlined into each adapter at build time.

Contains:

- `SessionCapturerBase` — orchestrates per-session capture (console/stream patching, WS connection, command-id bookkeeping, upstream-send guard with `onUpstreamDrop` hook).
- `TestReporterBase` — common reporter behavior, extended by Nightwatch + Selenium reporters (Service uses `@wdio/reporter` from WDIO directly).
- `ScreencastRecorderBase` — frame buffer + polling fallback shared by all three adapters.
- `resolveAdapterOutputDir` — the dir-resolution helper that picks where screencast/trace files land (test-file dir → config dir → cwd, with a `node_modules/` skip).
- Pure helpers: `assert-patcher`, `bidi` (`attachBidiHandlers`, `loadSeleniumSubmodule`, `arrayHeadersToObject`), `console` (`stripAnsi`, `detectLogLevel`, `createConsoleLogEntry`, `mapChromeBrowserLogs`, `chromeLogLevelToLogLevel`), `error` (`serializeError`, `errorMessage`), `finalize-screencast`, `net` (`isPortInUse`, `findFreePort`, `getRequestType`), `performance-capture` (`CAPTURE_PERFORMANCE_SCRIPT`, `applyPerformanceData`), `retry-tracker`, `script-loader` (`loadInjectableScript`, `pollUntilReady`), `stack` (`isUserCodeFrame`, `normalizeFilePath`, `getCallSourceFromStack`), `suite-helpers`, `test-discovery` (`findTestDefinitions`, `extractTestMetadata`), `uid` (`generateStableUid`, `deterministicUid`, `resetSignatureCounters`), `video-encoder` (`encodeToVideo`).

Imports from: `shared`. Imported by: all three adapter packages.

### `packages/service` — WebdriverIO adapter

WebdriverIO-specific glue.

Contains: WDIO service hooks (`beforeCommand`, `afterCommand`, `beforeTest`, `afterTest`, `beforeSession`, `afterSession`, `onPrepare`, `onComplete`), a reporter that extends WDIO's `Reporters.ReporterEntry`, the BiDi listener wiring (`bidi-listeners.ts`), launcher entry point, cucumber step-definition AST scanning, and the standalone runner (`standalone.ts`).

Imports from: `@wdio/types`, `@wdio/reporter`, `@wdio/logger`, `@wdio/protocols`, `webdriverio`, `core`, `shared`.

### `packages/nightwatch-devtools` — Nightwatch adapter

Nightwatch-specific glue.

Contains:

- The `NightwatchDevToolsPlugin` class + factory in `index.ts`.
- Lifecycle modules: `run-lifecycle.ts`, `test-lifecycle.ts`, `cucumber-lifecycle.ts`, `session-init.ts`, `event-hub.ts`.
- `BrowserProxy` (in `helpers/`) that wraps Nightwatch's browser API and forwards each command into the session capturer.
- A `SessionCapturer` subclass + a Nightwatch-flavored `SuiteManager` / `TestManager`.
- BiDi opt-in support (gated on `bidi: true` in plugin options + the `webSocketUrl: true` capability).
- Cucumber wiring: `cucumberHooks.cjs` (registered via the Cucumber `require` option), feature-file scanning, step-definition resolution.
- A perf-log → NetworkRequest parser (`helpers/perfLogs.ts`) for the CDP perf-log path when BiDi isn't attached.

Imports from: `@wdio/logger`, `core`, `shared`. Does not import: other adapter packages, `backend`, `app`.

### `packages/selenium-devtools` — Selenium adapter

Selenium-webdriver-specific glue.

Contains:

- `driverPatcher.ts` — wraps `selenium-webdriver`'s `WebDriver` / `WebElement` / `Builder` prototypes with command capture.
- Per-runner hooks for Mocha, Jest, Jasmine, Vitest, and Cucumber (`runnerHooks/*.ts`).
- Native BiDi via `selenium-webdriver/bidi`.
- Driver-launch + dashboard-launch helpers, detached-backend mode, process-hook shutdown.
- `SessionCapturer` subclass + Selenium-flavored `SuiteManager` / `TestManager`.

Imports from: `core`, `shared`, `selenium-webdriver` (peer). Does not import: other adapter packages, `backend`, `app`.

### `packages/backend`

The server adapters connect to and the app talks to.

Contains:

- Fastify HTTP server.
- WebSocket gateway: one connection per adapter worker, one per app client.
- Baseline store (in-memory) for preserve-and-rerun; reuses `shared` types directly via thin `*Like` aliases (`baseline/types.ts`).
- Test runner spawner (`runner.ts`) — spawns the user's `wdio` / `nightwatch` / `selenium` binary with rerun filters.
- Framework-specific CLI args live in `framework-filters.ts` — a `switch` over `TestRunnerId` returning the right `FilterBuilder`. (The switch shape is deliberate: CodeQL trusts compile-time-known callable selection, table dispatch trips its `unvalidated-dynamic-method-call` query.)
- Bin resolver (`bin-resolver.ts`) — finds the WDIO/Nightwatch CLI in the user's `node_modules/` or `npx` cache.
- Worker-message handler (`worker-message-handler.ts`) — dispatches messages from spawned workers (config/sessionId/videoPath/...).

Framework awareness lives only in `runner.ts` and `framework-filters.ts`, always through `TestRunnerId`, never magic strings.

Imports from: `shared`. Does not import: any adapter package, `app`, or `core` (the backend doesn't capture; core is for capturers).

### `packages/app`

The browser UI.

Contains:

- Lit web components (sidebar/explorer, workbench/compare, workbench/console, workbench/network, workbench/snapshot, etc.).
- WebSocket client for the live event stream.
- Context providers (`@lit/context`) for each data stream.
- `DataManagerController` — orchestrates the WS connection and the 11 context providers (one per scope).
- Pure helpers: suite-merge logic, mark-running logic, run-detection logic, context-update transforms (`contextUpdates.ts`), runner-capability derivations (`runnerCapabilities.ts`).

Imports from: `shared`. Does not import: any adapter package, `backend` directly (only via WS/HTTP), `core`.

### `packages/script`

Browser-injected runtime — runs **inside the page under test**, not in Node.

Contains: DOM mutation observers, page-side trace collection, a small logger. It's loaded into the page via `loadInjectableScript()` (which reads the built `dist/script.js`) and communicates back through the WebDriver bridge (`executeScript` / `getLog`), not directly to the backend.

The execution environment is the browser, not Node, so this package cannot import from `core` (Node-only) or from non-browser-safe parts of `shared`.

### `examples/`

Per-framework demo projects used for manual verification.

- `examples/wdio/` — WebdriverIO, split into `cucumber/` and `mocha/` (shared page objects in `pageobjects/`). Run via `pnpm demo:wdio` (Cucumber) or `pnpm demo:wdio:mocha`.
- `examples/nightwatch/` — Nightwatch (both vanilla and Cucumber). Run via `pnpm demo:nightwatch`.
- `examples/selenium/` — Selenium with subdirs for `mocha-test/`, `jest-test/`, `cucumber-test/`, `jasmine-test/`, `vitest-test/`. `pnpm demo:selenium` runs mocha; `pnpm --filter @wdio/selenium-devtools example:<runner>` runs the others.

---

## Data flow

### A test run, end to end

1. The user runs their normal command (`wdio run …`, `nightwatch test`, `mocha + selenium`, ...).
2. The framework loads its adapter via service/plugin config.
3. The adapter constructs a `SessionCapturer` (subclass of `core`'s `SessionCapturerBase`). The base class opens a WS connection to the backend, patches `console.*`, intercepts stdout/stderr, and installs the upstream-send guard.
4. The framework fires lifecycle hooks (suite/test start, command, etc.). The adapter translates each into a `core` call.
5. `core` builds the typed event per `shared` schema and pushes it through the WS.
6. `backend` receives the event, optionally persists it (baseline store, video registry), and broadcasts to every connected app client.
7. `app` updates its Lit components reactively via the context providers.

### Preserve-and-rerun

1. User clicks "📌 Preserve & Rerun" on a failed test in the dashboard.
2. App POSTs to `/api/baseline/preserve` (typed contract in `shared`).
3. Backend snapshots the failing attempt into the baseline store, then spawns a rerun via `runner.ts`.
4. The rerun goes through the normal flow above.
5. App receives both attempts and renders the side-by-side compare view.

### Rerun mechanics

`backend/src/runner.ts` is the only place outside an adapter that knows about specific frameworks. It uses `TestRunnerId` from shared and dispatches via `framework-filters.ts`'s `switch`:

- `cucumber`: `--spec <feature[:line]>` and/or `--cucumberOpts.name <regex>`.
- `mocha`/`jasmine`: `--spec <file>` + `--mochaOpts.grep`/`--jasmineOpts.grep`.
- `nightwatch`: positional spec file + optional `--testcase <name>`.
- `nightwatch-cucumber`: `--name <regex>` (feature files via `feature_path` config).
- Unknown/missing: spec-only fallback.

Everywhere else in the system, events are framework-agnostic.

---

## Boundaries

Every data crossing between packages goes through a typed contract in `shared`:

| Boundary | Direction | Transport | Lives in |
|---|---|---|---|
| Adapter → backend | One-way events (command, console, network, mutation, …) | WebSocket frames | `shared/ws.ts` (`SocketMessage<T>`) |
| App → backend | Preserve, clear, run, stop, get-baseline | HTTP (Fastify) | `shared/baseline.ts`, `shared/runner.ts` |
| Backend → app | Live event broadcast + API responses | WebSocket + HTTP | `shared/ws.ts`, `shared/baseline.ts` |
| Backend → spawned worker | Run config, rerun env, video paths | Env vars + IPC | `shared/runner.ts` (`REUSE_ENV`, `RUNNER_ENV`) |
| Script → adapter | Mutation events, trace data | `executeScript` return values + `getLog` channel | Implicit in adapter — script's payload shape is consumed by core's `processTracePayload` |

New events or HTTP routes start with a `shared` change. The other packages then import the contract.

---

## Where things live

The repo has converged on a clear ownership story. When in doubt, the top-down decision tree is:

- A type, constant, enum, schema, or contract used by more than one package → **`shared`**.
- Capture, parsing, normalization, sourcemap, UID, reporter, screencast, or WS-framing logic that doesn't depend on a specific framework's API → **`core`**.
- A specific framework's hook, driver patch, or runner integration → the matching **adapter** package. Adapter code calls `core` for the actual work and only owns the hook registration.
- A backend HTTP route, WS handler, or rerun behavior → **`backend`**, with the contract added to `shared` first.
- UI → **`app`**, consuming `shared` contracts only.
- Code that runs inside the browser under test → **`script`**.

A few cross-cutting conventions follow from this layout:

- Adapter packages don't import each other. Anything two adapters would both want lives in `core`.
- Backend doesn't import adapter packages, and adapter packages don't import backend or app.
- The script package is a leaf — adapters load its built bundle as a string and inject it; they don't import from it at runtime.
- `shared` and `core` are private workspace packages. Consumers bundle them. The bundler config has to inline them (not externalize) or the published artifact won't resolve — see the build-config notes in `CLAUDE.md`.

---

## Current state

The architecture above is the actual state of the repo. Where it diverges from the ideal, the divergences are tracked in [CLAUDE.md §7](./CLAUDE.md#known-debt).

Notable in-place pieces worth knowing about:

- `replaceCommand` has two semantics across adapters — Selenium mutates the existing entry in place (preserves `_id`/`id` continuity for chained calls); Nightwatch splices and reissues with a new `_id`. Both call the same `core/suite-helpers` factories; the storage strategy stays adapter-specific because the runner integrations differ.
- `patchNodeAssert` is wired only in `selenium-devtools` (Selenium's primary assertion style is `node:assert`). The shared helper lives in `core/assert-patcher`; Service and Nightwatch can opt in via a one-line call when they need to, but it's not auto-enabled because both communities lean on chai/expect.
- BiDi is auto-attached in Service and Selenium. Nightwatch is opt-in via `bidi: true` and requires `webSocketUrl: true` in capabilities — historically Nightwatch users haven't all enabled BiDi by default.
- Performance API capture (`CAPTURE_PERFORMANCE_SCRIPT`) is identical across all three adapters; each wires it into its own afterCommand-equivalent path.
- Output directory for screencast videos and trace files is resolved through `core/resolveAdapterOutputDir` — adapters feed `userConfiguredDir` (WDIO honors `wdio.conf.ts`'s `outputDir`/`rootDir`), `testFilePath` (Selenium/Nightwatch), and `configPath` (Nightwatch), and the helper picks the first writable, non-`node_modules/` candidate.

For per-package implementation details, see each package's `README.md`
