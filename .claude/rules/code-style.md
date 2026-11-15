---
paths:
  - "packages/**/*.{ts,py}"
---

# Code style

Scope: package source and tests.

## Rules

- Satisfy lint's `no-explicit-any`, the file and function size caps (logic lines) and `no-unused-vars`; their values live in `eslint.config.cjs`.
- Keep each file to one concern: UI components render; controllers and services own I/O and state; route handlers wire requests to services. Why: mixed-concern files are split when touched.
- Write `as unknown as X` only with the reason documented inline. Why: no lint rule catches it, and it silently bypasses the type check.
- Use `type` for unions and `interface` for object shapes that may be extended.
- Treat names exported from `shared` and `core` as public API. Why: a rename is a breaking change for downstream packages.
- One name per concept: `TestStatus` in `shared` is canonical, and the sidebar's `TestState` (`packages/app/src/components/sidebar/types.ts`) is a value-only accessor over the same union. Why: two names for one concept drift apart.
- Constants are `SCREAMING_SNAKE_CASE`, types `PascalCase`, functions and variables `camelCase`.
- New files are `kebab-case.ts`. Existing camelCase files (e.g. `packages/selenium-devtools/src/driverPatcher.ts`) are legacy: rename one when touched, if the surrounding code stays consistent.
- Put each JS adapter's `SessionCapturer` in its `session.ts`, extending `SessionCapturerBase` (`packages/core/src/session-capturer.ts`). Why: the base class carries the capture lifecycle all adapters share.
- Write no comment by default. Write one only for a non-obvious why, one line max. Do not write `TODO`, `added for X`, `removed Y` or `keep in sync`. Why: the first three belong in git history, and the last means a single source of truth is missing.
- Validate at boundaries (HTTP, WS, framework callbacks); internal code trusts its inputs. Why: one validation point per input keeps the internal code simple.
- A `catch` adds context, then rethrows or logs with enough detail to debug. No empty catches. Why: a swallowed error leaves nothing to debug.
- Delete unused exports, unused imports, commented-out code and `_unused` parameters when found. Why: git history is the safety net for code that may be needed later.

## Accepted residuals

- The `#getInternals` accessor bags in the Nightwatch and Selenium plugins exceed the function cap on purpose. Each carries an inline `eslint-disable-next-line max-lines-per-function` with a one-line justification.
