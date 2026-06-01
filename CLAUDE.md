# CLAUDE.md

This file is the contract for working in this repository. It applies to **all code in this repo** — existing and new alike. There is no "legacy carve-out": code that does not yet comply is debt, and every change must move the repo closer to compliance, never further from it.

Both human contributors and AI agents (Claude Code) must follow it. When a rule here conflicts with what looks easier in the moment, the rule wins.

If you are an AI agent: read this file in full before making any non-trivial change. When in doubt, ask the user.

---

## 1. What this repo is

A devtools UI for end-to-end browser tests, supporting three frameworks (WebdriverIO, Nightwatch, Selenium) with **one backend and one UI**. The frameworks are adapters that feed the same backend the same event stream.

Packages (pnpm workspace):

| Package | Role |
|---|---|
| `packages/app` | Lit-based browser UI. Framework-agnostic. |
| `packages/backend` | Fastify server, WebSocket gateway, baseline store, test runner spawner. Framework-agnostic at the API layer; framework-aware only via a typed `FrameworkId`. |
| `packages/shared` | Types, constants, HTTP/WS contracts. Pure, no runtime deps on other packages. Single source of truth. Workspace-internal (`"private": true`); inlined into each consumer at build time. |
| `packages/core` | Framework-agnostic capture/reporter logic. Currently houses console-capture constants and helpers, UID gen, error serialization, stack helpers, net helpers, `SessionCapturerBase` (extended by all three adapters), and `TestReporterBase` (extended by nightwatch + selenium reporters). Workspace-internal (`"private": true`); inlined into each adapter at build time. |
| `packages/service` | WebdriverIO adapter. Hook registration + WDIO-specific config. |
| `packages/nightwatch-devtools` | Nightwatch adapter. Hook registration + lifecycle binding. |
| `packages/selenium-devtools` | Selenium adapter. Driver patching + runner hooks. |
| `packages/script` | Browser-injected runtime. Runs **inside the page under test** (not in Node), captures DOM mutations and page-side traces. Not a home for shared Node-side logic — that belongs in `core`. |
| `examples/wdio/`, `examples/nightwatch/`, `examples/selenium/` | Per-framework demo projects, used for manual verification (§4). |

Both `packages/shared` and `packages/core` exist and host the shared types, contracts, and adapter scaffolding. The `SessionCapturerBase` class in `core` owns console/stream patching, WS connection, command id bookkeeping, and upstream-send guard/try-catch (with an `onUpstreamDrop` hook subclasses can override for diagnostics); all three adapters extend it. `TestReporterBase` is shared by the nightwatch + selenium reporters (service uses `@wdio/reporter` from WDIO). Remaining `core` candidate is a handful of partially-shared `TIMING`/`DEFAULTS` constants.

### Commands

Run from repo root unless noted:

| Command | What it does |
|---|---|
| `pnpm install` | Install workspace dependencies. |
| `pnpm build` | Build all packages (`pnpm -r build`). |
| `pnpm test` | Run vitest suite once. |
| `pnpm test:watch` | Run vitest in watch mode. |
| `pnpm lint` | Lint all packages in parallel. |
| `pnpm demo:wdio` | Run the WebdriverIO example. |
| `pnpm demo:nightwatch` | Run the Nightwatch example. |
| `pnpm demo:selenium` | Run the Selenium example (mocha runner by default; selenium-devtools also exposes `example:mocha` / `example:jest` / `example:cucumber` for per-runner variants). |
| `pnpm dev` | Run all packages in parallel dev mode. |

Before any UI/runtime change is claimed done: `pnpm build && pnpm test && pnpm demo:wdio` (or `demo:nightwatch` / `demo:selenium` if your change targets that framework).

### Path aliases (TypeScript)

Defined in root `tsconfig.json`. Use these in imports — do **not** use long relative paths like `../../../components/...`:

| Alias | Resolves to |
|---|---|
| `@/*` | `packages/app/src/*` |
| `@components/*` | `packages/app/src/components/*` |
| `@core/*` | `packages/app/src/core/*` (app-internal, not the future `packages/core`) |
| `@wdio/devtools-backend` / `@wdio/devtools-backend/*` | `packages/backend/src/...` |
| `@wdio/devtools-script` / `@wdio/devtools-script/*` | `packages/script/src/...` |
| `@wdio/devtools-service` / `@wdio/devtools-service/*` | `packages/service/src/...` |
| `@wdio/selenium-devtools` / `@wdio/selenium-devtools/*` | `packages/selenium-devtools/src/...` |

`packages/shared` and `packages/core` are both wired in (`@wdio/devtools-shared`, `@wdio/devtools-core`).

> ⚠️ Note: `@core/*` today points to `packages/app/src/core/` (app-internal). The future framework-agnostic `packages/core` will need a different alias (e.g. `@wdio/devtools-core`) to avoid collision. Resolve this when `packages/core` is created.

---

## 2. Architecture rules

These apply to every file in the repo. Code that doesn't comply is debt to be fixed (§7), not an exception.

### 2.1 One source of truth per concept

No type, constant, enum, schema, or contract may be defined in more than one package. Every shared concept lives in `packages/shared`.

If a duplicated declaration is discovered, the next change that touches it must consolidate to `shared`.

### 2.2 Framework-agnostic logic lives in `core`

Any capture, parsing, normalization, sourcemap, UID, reporter, or WS-framing logic is framework-agnostic and lives in `packages/core`. Adapter packages call into `core`; they do not reimplement.

If a feature requires the same logical change in two or more adapters, the logic does not belong in the adapters — it belongs in `core`. Stop and extract.

### 2.3 Adapters are thin and isolated

Adapter packages (`service`, `nightwatch-devtools`, `selenium-devtools`) own only:
- Framework-specific hook registration and lifecycle binding
- Framework-specific driver/browser patching
- Framework-specific config

They **may not** import from each other. They **may** import from `shared` and `core`. They **may not** be imported by `backend` or `app`.

### 2.4 `backend` and `app` are framework-agnostic

`backend` and `app` import from `shared` (for contracts) and from each other only via the WS/HTTP boundary. They do not import any adapter package.

If `backend` needs to behave differently per framework (e.g. building rerun CLI args in `runner.ts`), it branches on a typed `FrameworkId` from `shared`. **No string comparisons like `if (framework === 'nightwatch')`** anywhere outside an adapter.

### 2.5 Boundaries have typed contracts

Every `fetch(...)` and `ws.send(...)` has a typed request/response shape defined in `shared`. No untyped `any` payloads cross a package boundary. No "the caller knows what shape comes back" agreements.

### 2.6 Workspace-internal packages must stay inlined at build time

`packages/shared` and (when it exists) `packages/core` are marked `"private": true` and are **never published to npm**. Each consuming package's bundler must inline their code into its own `dist/` at build time. **Packages that consume `@wdio/devtools-shared` or `@wdio/devtools-core` must use a bundler — `tsc`-only builds emit literal `import` statements that npm cannot resolve at install time.**

Bundlers in use today: **vite** for `app`, `service`, `script`; **tsup** for `backend`, `nightwatch-devtools`, `selenium-devtools`.

- List `@wdio/devtools-shared` / `@wdio/devtools-core` in `devDependencies` with `workspace:^`, **never** in `dependencies`. Both tsup and vite externalize anything in `dependencies` by default — `devDependencies` is what gets inlined. If the dep leaks into `dependencies`, pnpm publish rewrites the version to something that doesn't exist on npm and end-user installs fail.
- Do **not** add `@wdio/devtools-shared` or `@wdio/devtools-core` to `rollupOptions.external` (vite) or to tsup's `external` option, or any equivalent. **Vite `external` callback footgun (bit us twice already):** vite resolves workspace imports BEFORE invoking the callback, so the `id` parameter is often an absolute path like `/Users/.../packages/core/src/index.ts`, *not* the package name `@wdio/devtools-core`. A check like `id !== '@wdio/devtools-core'` will silently miss the absolute-path form, and the dist ends up with literal absolute paths that work nowhere but the build machine. Always check for BOTH forms: package name (`id === '@wdio/devtools-core'`, `id.startsWith('@wdio/devtools-core/')`) AND resolved path (`id.includes('/packages/core/')`). See [`packages/service/vite.config.ts`](packages/service/vite.config.ts) for the canonical pattern.
- Do **not** switch a consuming package's build to `tsc`-only. If the package needs a build, it gets a bundler.
- After any change to a bundler config or build script, run `pnpm build` on the affected package and verify its `dist/*.js` contain no references to private workspace packages — **check both forms**:
  - `grep -E "@wdio/devtools-(core|shared)|/packages/(core|shared)/" packages/<pkg>/dist/*.js` should return nothing. Checking only `@wdio/devtools-core` misses the absolute-path form vite leaves behind when its `external` callback is misconfigured.

### 2.7 Separation of concerns within a file

A file owns one concern. Specifically:
- **UI components render.** They do not call `fetch`, manage WebSocket state, or run business logic.
- **Controllers/services own I/O and state.** They do not render.
- **Backend route handlers wire requests to services.** They do not contain business logic inline.
- **Reporters report.** They do not also do sourcemap resolution, file I/O, and step UID generation in the same file.

A file that mixes these concerns is debt and must be split when next touched.

---

## 3. Coding standards

### TypeScript

- `strict: true` is on (configured in root `tsconfig.json`). Do not weaken it.
- **No `any`.** If a framework or library forces it, isolate the `any` to one line at the boundary and cast to a typed shape immediately. Add a one-line comment explaining why.
- **No `as unknown as X`** double-casts unless the reason is documented inline.
- Prefer `type` for unions and `interface` for object shapes that may be extended.
- Exported names from `shared` and `core` are public API of those packages — treat renames as breaking changes.

### Naming

- **One name per concept across the whole repo.** The canonical name for test status is `TestStatus` in `@wdio/devtools-shared`. The sidebar `TestState` object is a value-only enum-style accessor; its values come from `TestStatus`.
- Constants: `SCREAMING_SNAKE_CASE`. Types: `PascalCase`. Functions and variables: `camelCase`. Files: `kebab-case.ts` unless matching a class name.

### File and function size

- **File**: ~400 lines. A larger file is a smell; do not add to it without splitting.
- **Function**: ~50 lines.
- Known god-files that must be split as they're touched: `packages/app/src/controller/DataManager.ts` (~986 lines), `packages/app/src/components/workbench/compare.ts` (~888 lines), `packages/app/src/components/sidebar/explorer.ts` (~670 lines), `packages/backend/src/index.ts` (~387 lines).

### Comments

- Default to no comments. Names should explain *what*.
- Write a comment only when the *why* is non-obvious: a hidden constraint, a workaround for a specific bug, a subtle invariant.
- Do not write `// TODO`, `// added for X feature`, `// removed old logic`, or `// keep in sync` comments. Git history holds the first three; the fourth means you should have used a single source of truth.
- One line max. No multi-paragraph docstrings.

### Error handling

- Validate at boundaries (HTTP input, WS messages, framework callbacks). Trust internal code.
- Never swallow errors silently. Catch only to add context, then rethrow or log with enough detail to debug.
- No `catch (e) {}` blocks. No empty catches.

### Dead code

- Delete unused exports, unused imports, commented-out blocks, and `_unused` parameters when you find them.
- Do not keep "in case we need it later" code. Git history is the safety net.

---

## 4. Testing

The repo uses **vitest** at the root.

### Required

- **`shared` and `core`**: unit tests for every new exported function or type guard. These are the foundation; bugs here cascade.
- **Bug fixes (any package)**: a regression test that fails before the fix and passes after. If you genuinely can't write one (e.g. it requires a real browser and the infra doesn't exist), say so explicitly in the PR.
- **New HTTP/WS contracts**: a test that exercises the contract end-to-end at least once.

### Recommended

- Adapter packages: unit tests for non-trivial parsing or transformation logic. Hook-wiring may be verified manually via `examples/<framework>/`.
- `backend` and `app`: tests for non-UI logic (parsers, transforms, state reducers).

### Manual verification

For UI or runtime changes, you **must** run the change in `examples/<framework>/` before claiming the work is done. Type-checks and unit tests verify code correctness, not feature correctness. If you cannot run the example, say so explicitly — do not claim success on the basis of `tsc --noEmit` alone.

---

## 5. Workflow

### Before you start

1. Read this file.
2. Read the README of any package you're touching.
3. Ask: does this change belong in the package I'm about to edit, or does it belong in `shared` / `core`? If `shared` or `core` — go there first.

### While you work

- Make the minimum change that solves the problem. No drive-by refactors of unrelated code, no speculative abstractions for hypothetical future requirements.
- **The boy-scout rule applies always.** When you touch a file or a section, leave it more compliant with this document than you found it. If you touch a duplicated type, consolidate it into `shared`. If you edit a section of a god-file, split that section out. If you change a magic-string framework check, replace it with a typed `FrameworkId`. The scope of cleanup matches the scope of your change — don't rewrite the whole file, but don't leave a clear violation in the lines you touched either.
- Do not introduce new violations to "match the existing style." The existing style is debt.

### Before you finish

- Run `pnpm build`, `pnpm test`, and `pnpm lint`. Don't push red.
- Re-read your diff. Delete anything you wouldn't be able to justify to a reviewer.
- For UI/runtime changes, verify in `examples/<framework>/`.
- Check: does the diff reduce or increase the count of known debt items in §7? If it increases, reconsider.

### Commits

- Small, focused commits. Don't bundle unrelated changes.
- Imperative mood. Explain *why*, not *what* — the diff shows the what.
- Never amend commits that have been pushed or shared.
- Never use `--no-verify` to skip hooks. If a hook fails, fix the underlying problem.

### PRs

- One concern per PR. A refactor and a feature are two PRs.
- If the PR touches more than one adapter package, the description must answer: **why isn't this in `core`?**
- Note in the PR description which debt items from §7 (if any) the change paid down.

---

## 6. What an AI agent (Claude) should do

You are expected to treat this file as a hard contract.

### Refuse

- Adding a type, constant, enum, or contract that duplicates one that exists in another package. Propose extracting to `shared` instead.
- Adding an `any` type at a package boundary.
- Adding `if (framework === '...')` or any string-based framework check outside an adapter package.
- Making the same logical change in two or more adapter packages. Propose extracting to `core` instead.
- Adding a `// TODO`, `// keep in sync`, or similar comment as a substitute for fixing the underlying issue.
- Skipping pre-commit hooks with `--no-verify`.
- Claiming a UI/runtime change works without running it in `examples/<framework>/`.
- Importing one adapter package from another, or importing any adapter from `backend` or `app`.

### Warn, then proceed if the user confirms

- A file or function exceeds the soft size limits in §3.
- A change that grows a god-file rather than splitting the section being edited.
- Adding a feature behind a flag without an explicit request.

### Do without asking

- Run formatters, type checks, and tests.
- Move a duplicated type or constant to `shared` (creating the package if needed) as part of a change that touches it. That's the boy-scout rule, not scope creep.
- Split the *section being edited* out of a god-file. Do not rewrite the whole file uninvited.
- Replace a string-based framework check with a typed `FrameworkId` when you're editing the file containing it.

### Always

- State the planned approach in one or two sentences before making non-trivial changes, especially anything touching package boundaries.
- When the right place for new code is ambiguous (`shared` vs `core` vs adapter), ask the user before writing it.
- After completing a change, in one or two sentences: what changed, what's next, and which §7 debt item the change moved (if any).

---

## 7. Known debt

These are documented violations of this file's rules. They exist today; they are debt, not exceptions. Every change must reduce this list, never extend it. As items are resolved, delete them from this section.

### Architecture debt

- `packages/shared` contains `BASELINE_API`, `BASELINE_WS_SCOPE`, `TestRunnerId`, and the core test-event types (`CommandLog`, `ConsoleLog`, `NetworkRequest`, `Metadata`, `TraceLog`, `TraceType`, `PreservedAttempt`, `PreservedStep`, `TestStatus`, `TestError`, `TestStats`, `SuiteStats`, `ReporterError`, `PerformanceData`, `DocumentInfo`, `Viewport`, `ScreencastInfo`, `LogLevel`). `SuiteStats.featureFile` is the cucumber-only `.feature` path, distinct from `file` (which owns the suite's stable UID and stays at cwd). Adapter type files re-export shared types for backwards compatibility.
- `packages/core` contains console-capture constants and helpers (`CONSOLE_METHODS`, `ANSI_REGEX`, `LOG_LEVEL_PATTERNS`, `LOG_SOURCES`, `ERROR_INDICATORS`, `stripAnsi`, `detectLogLevel`, `createConsoleLogEntry`, `isInternalStreamLine`, `SPINNER_RE`), stable-UID helpers (`generateStableUid`, `deterministicUid`, `resetSignatureCounters`), stack-frame helpers (`isUserCodeFrame`, `normalizeFilePath`, `getCallSourceFromStack`), `serializeError` (returns `SerializedError`), net helpers (`isPortInUse`, `findFreePort`, `getRequestType`), `chromeLogLevelToLogLevel`, the `SessionCapturerBase` abstract class, and the `TestReporterBase` abstract class. Adapter `SessionCapturer` and `TestReporter` subclasses contain only framework-specific logic.
- Remaining adapter-side duplication: partially-shared `TIMING`/`DEFAULTS` constants (each adapter has framework-specific values, so partial sharing only saves a handful of lines). Service's WDIO-specific Cucumber UID branching stays in `service/reporter.ts` and delegates the actual hashing to core. The `sendUpstream` guard/try-catch is now in base; subclasses override `onUpstreamDrop` only when they want diagnostics on drop.
- `TraceMutation` is defined in `packages/script/types.d.ts` as a global (browser-only, depends on DOM types). Adapters and backend currently sidestep this with loose `unknown[]` / `MutationLike` types. A clean home for browser/page-side types is open: extract from script into a small package consumable by both browser and Node consumers, or accept that mutation arrays cross the boundary as `unknown[]`.

### File-size debt (god-files to split as touched)

- `packages/app/src/controller/DataManager.ts` (~986 lines)
- `packages/app/src/components/workbench/compare.ts` (~888 lines)
- `packages/app/src/components/sidebar/explorer.ts` (~670 lines)
- `packages/backend/src/index.ts` (~387 lines)

### Type-safety debt

_(All known type-safety debt resolved. New violations should still be tracked here as they're discovered.)_

---

## 8. Living document

This file is expected to evolve. When you discover a recurring decision point it doesn't cover, propose adding it. When a rule turns out to be wrong in practice, propose changing it.

Do not silently ignore rules. If a rule is getting in the way of real work, that's a signal to fix the rule, not to break it.
