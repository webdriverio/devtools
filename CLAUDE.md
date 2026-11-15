# Repo conventions

This file is the router. Architecture and data flow are in [ARCHITECTURE.md](./ARCHITECTURE.md). Path-scoped rules are in `.claude/rules/` and load when a matching file is read. Package history and debt are in each `packages/<pkg>/CLAUDE.md`.

## What this repo is

A devtools dashboard for end-to-end browser tests: WebdriverIO, Nightwatch and Selenium adapters push one normalized event stream through a backend into a Lit UI.

---

## Commands

Run from repo root unless noted.

| Command | What it does |
|---|---|
| `pnpm install` | Install workspace dependencies. |
| `pnpm build` | Build all packages (`pnpm -r build`). |
| `pnpm test` | Run the vitest suite once (no coverage). |
| `pnpm test:watch` | Run vitest in watch mode. |
| `pnpm test:coverage` | Run vitest with v8 coverage. Not a CI gate; see Known debt. |
| `pnpm lint` | Lint all packages in parallel, including `eslint-plugin-security`. |
| `pnpm demo:wdio` / `:nightwatch` / `:selenium` / `:python:pytest` | Run the per-framework examples. `demo:wdio` and `demo:selenium` (Selenium cucumber) default to live, `demo:nightwatch` defaults to trace; `DEVTOOLS_MODE=live` or `trace` flips each. The pytest example traces only with `DEVTOOLS_MODE=trace`. Details: examples/CLAUDE.md |
| `pnpm demo:wdio:mobile` / `:selenium:mobile` / `:nightwatch:mobile` / `:python:mobile` | The same against Appium. Details: examples/CLAUDE.md, examples/MOBILE.md |
| `pnpm dev` | Run all packages in parallel dev mode. |
| `pnpm smoke:fixtures [--port N]` | Serve the local fixture site the desktop examples drive (default `http://127.0.0.1:4567`). Details: .claude/rules/examples-smoke.md |
| `pnpm smoke:assert --expect <name> ...` | Check trace zips against `packages/conformance/smoke/expectations/<name>.json`. Details: packages/conformance/CLAUDE.md |
| `pnpm player:hosted` | Build and serve the hosted trace player at `http://localhost:4173`. Details: .claude/rules/hosted-player.md |
| `pnpm player:e2e [--headed] [--port N]` | Hosted-player check in headless Chrome. Details: packages/conformance/CLAUDE.md, .claude/rules/hosted-player.md |
| `pnpm docs:capabilities` | Render the capability tables into `README.md` (`--website`, `--check`, `--parity`). Details: .claude/rules/capability-tables.md |
| `python3 packages/selenium-devtools-py/scripts/changes.py next-version` | Version a Python-adapter release would publish. Details: .claude/rules/releasing.md |

`selenium-devtools` per-runner variants: `pnpm --filter @wdio/selenium-devtools example:mocha` / `:mocha:allure` / `:jest` / `:cucumber`.

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
| `@wdio/nightwatch-devtools/*` | `packages/nightwatch-devtools/src/*` (subpaths only, for type imports such as the option types) |
| `@wdio/devtools-shared` / `*` | `packages/shared/src/...` |
| `@wdio/devtools-core` / `*` | `packages/core/src/...` |
| `@wdio/devtools-trace` / `*` | `packages/trace/src/...` |
| `@wdio/elements` / `*` | `packages/elements/src/...` |

These exist so imports stay short and grep-able. Long relative paths (`../../../components/…`) aren't used.

The `@core/*` name is a historical alias for app-internal helpers and predates `packages/core`. They don't collide because they resolve to different roots, but the names are confusable.


## Layering

- `shared` owns every shared type, constant, schema and HTTP/WS contract. No package re-declares one.
- `trace` holds the pure transforms from captured events to trace zips, and the zip reader. It imports only `shared`. `backend` may import `trace`; it may not import `core`.
- `core` holds framework-agnostic capture, parsing and transport.
- Adapters (`service`, `nightwatch-devtools`, `selenium-devtools`, `selenium-devtools-py`) are thin: framework hooks, driver patching, config.
- The JS adapters import `shared` and `core`. `selenium-devtools-py` imports neither (it ships no Node); its shared logic is mirrored and held equal by `packages/shared/mirror-vectors.json` (.claude/rules/mirror-vectors.md).
- No adapter imports another (enforced by `eslint.config.cjs`). Only examples and conformance scenarios import adapters at runtime; `packages/conformance/src/capability-options.ts` uses `import type` only.
- `backend` and `app` import `shared` and each other over WS/HTTP. Neither imports an adapter.
- Boundaries are typed: every `fetch` and `ws.send` has a `shared` type, and no `any` crosses a package boundary.
- `shared`, `trace` and `core` are bundled into their consumers, never externalised: .claude/rules/bundling.md.
- Files own one concern. Size caps and style: .claude/rules/code-style.md.
- A helper that is framework-agnostic but used by one adapter stays in that adapter until a second consumer appears, then moves to `core`.
- A duplicate is consolidated into `shared` by the next change that touches either copy; adapters re-export shared definitions when a local name must stay stable (e.g. nightwatch's `TEST_FILE_PATTERN`).
- `SocketMessage<T extends WsMessageScope>` is the canonical WS wire format; receivers narrow on `scope`.
- A framework-forced `any` is cast to a typed shape immediately at the boundary, with the cast site saying why.
- `trace` importing `core` is an ESLint error (`eslint.config.cjs`).

## Testing

Tests run with **vitest** at the root (`pnpm test`).

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

`packages/core/tests/script-loader.test.ts` is gated by `it.skipIf(!scriptPackageAvailable)` and needs `@wdio/devtools-script` built first.

---

## Workflow

### When adding code

The decision tree from [ARCHITECTURE.md "Where things live"](./ARCHITECTURE.md#where-things-live) is the starting point. The general shape:

- Shared concept → `shared`.
- Pure transform producing trace-zip content → `trace`.
- Framework-agnostic capture/reporting logic → `core`.
- Framework-specific glue → the matching adapter.
- Server route/WS handler → `backend` (contract in `shared` first).
- UI → `app`.
- Code that runs in the browser under test → `script`.

When the right place is ambiguous (something between `shared` and `core`, or between `core` and an adapter), the question that resolves it is: *who else would want this?* If the answer is "any future adapter would," it's `core`. If "only the framework with X-specific API does," it's the adapter. If "the backend would, to build a zip for an adapter that can't," it's `trace`.

### While editing

- Leave touched code more aligned with these conventions than you found it; cleanup scope matches change scope.
- New code does not copy existing violations; those are documented debt (§ Known debt).

### Before pushing

- CI (`.github/workflows/ci.yml`) runs: the `build` job (`pnpm lint`, `pnpm -r build`, `pnpm typecheck`, `pnpm test`); `component-tests` (`pnpm test:ui`); `hosted-player` (`pnpm player:e2e`); `examples-smoke` (the four desktop examples against the fixture site); and `wdio-peer` (type-checks against a matrix of WebdriverIO versions). Don't push red.
- A changeset for a published npm package, or a `changes/` fragment for the Python adapter — see `.claude/rules/releasing.md`.
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

README and webpage mirror rules, and generated capability tables: .claude/rules/capability-tables.md.

## Package map

Read a package's CLAUDE.md before changing it; codegraph reads do not auto-load it.

- `shared`: types, constants, schemas, HTTP/WS contracts. Notes: packages/shared/CLAUDE.md
- `core`: framework-agnostic capture, normalisation and transport for the adapters. Notes: packages/core/CLAUDE.md
- `trace`: trace-zip writer and reader. Notes: packages/trace/CLAUDE.md
- `script`: the page-injected collector bundle. Notes: packages/script/CLAUDE.md
- `service`: WebdriverIO service adapter. Notes: packages/service/CLAUDE.md
- `nightwatch-devtools`: Nightwatch plugin adapter. Notes: packages/nightwatch-devtools/CLAUDE.md
- `selenium-devtools`: Selenium adapter for mocha, jest and cucumber. Notes: packages/selenium-devtools/CLAUDE.md
- `selenium-devtools-py`: Python pytest and Selenium adapter; ships no Node. Notes: packages/selenium-devtools-py/CLAUDE.md
- `backend`: Node dashboard server (WS/HTTP, reruns, zip serving). Notes: packages/backend/CLAUDE.md
- `app`: Lit dashboard UI and the hosted trace player. Notes: packages/app/CLAUDE.md
- `conformance`: smoke assertions, capability tables, hosted-player e2e, `KNOWN_GAPS`. Notes: packages/conformance/CLAUDE.md
- `elements`: `@wdio/elements`, element detection scripts for WebdriverIO. No CLAUDE.md.
- `examples/`: runnable demos per framework, fixture site, mobile. Notes: examples/CLAUDE.md

Scoped rules in `.claude/rules/`, each loaded when a matching file is read:
- when editing package source: `code-style.md` (file/function size, naming, TypeScript rules)
- when editing a package manifest, bundler config or `pnpm-workspace.yaml`: `bundling.md`
- when changing a changeset, a Python-adapter fragment or pyproject, or a release workflow: `releasing.md`
- when touching mirrored logic or `mirror-vectors.json`: `mirror-vectors.md`
- when editing the trace-zip writer or reader: `trace-format.md`
- when editing the hosted player or its CSP: `hosted-player.md`
- when editing conformance sources, a README or the capability tables: `capability-tables.md`
- when editing examples, smoke fixtures or expectations: `examples-smoke.md`
- when editing capture code in core, service, the Selenium and Nightwatch adapters, script or the Python adapter: `capture-invariants.md`
- when editing per-action capture or screencast cost paths in core: `capture-cost.md`
- when editing network capture: `network-capture.md`
- when editing the document-start preload or session bringup: `doc-start-injection.md`
- when editing assert capture: `assert-capture.md`

## Known debt

Debt and design history live in the owning package's CLAUDE.md, not here.

- Architecture and capture debt: the CLAUDE.md of the package whose files an entry names; a cross-adapter entry sits in `core`, `shared` or `trace`.
- File-size overruns: packages/service, nightwatch-devtools, selenium-devtools, app and selenium-devtools-py CLAUDE.md.
- Coverage gaps (worst first): packages/service, nightwatch-devtools, selenium-devtools and backend CLAUDE.md.
- The coverage thresholds in `vitest.config.ts` (85/77/86/85) are not a CI gate: CI's `pnpm test` collects no coverage.


## Living document

When a convention proves wrong in practice, update it here rather than breaking it silently.
