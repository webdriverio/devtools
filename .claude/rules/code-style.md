---
paths:
  - "packages/**/*.{ts,tsx,py}"
---

### Separation of concerns within a file

Files own one concern:

- UI components render. They don't `fetch`, manage WebSocket state, or run business logic.
- Controllers and services own I/O and state. They don't render.
- Backend route handlers wire requests to services. They don't contain business logic inline.
- Reporters report. They don't also resolve sourcemaps, read files, and generate step UIDs in the same module.

Mixed-concern files are split as they're touched.

### TypeScript

- `strict: true` is on (root `tsconfig.json`).
- No `any`. If a framework or library forces it, the `any` is isolated at the boundary and cast to a typed shape with a one-line comment explaining why.
- No `as unknown as X` double-casts unless the reason is documented inline.
- `type` for unions, `interface` for object shapes that may be extended.
- Names exported from `shared` and `core` are public API of those packages — renames are breaking changes for downstream consumers.

### Naming

- One name per concept across the whole repo. The canonical test-status name is `TestStatus` in shared; the sidebar `TestState` is a value-only enum-style accessor over the same string union.
- Constants are `SCREAMING_SNAKE_CASE`. Types are `PascalCase`. Functions and variables are `camelCase`. New files are `kebab-case.ts`. Existing camelCase files (e.g. `driverPatcher.ts`) are legacy: rename one when you touch it, if the rename leaves the surrounding code consistent. Each adapter's `SessionCapturer` class lives in its `session.ts` and extends `SessionCapturerBase` from `packages/core/src/session-capturer.ts`.

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

