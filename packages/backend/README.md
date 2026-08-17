# @wdio/devtools-backend

The server that the three adapter packages connect to and the dashboard UI talks to. Published to npm as `@wdio/devtools-backend` (it's on [CONTRIBUTING.md](../../CONTRIBUTING.md)'s list of published packages, has a `prepublishOnly` build, and ships the `devtools-backend` and `show-trace` bins); the adapters depend on it rather than vendoring it.

## Responsibilities

- **Fastify HTTP server** — REST endpoints for preserve/clear/run/stop and the dashboard's baseline pair lookups.
- **WebSocket gateway** — one connection per adapter worker, one per dashboard client. Adapter events fan out to every connected dashboard.
- **Baseline store** (in-memory) — captures a snapshot of a failing test attempt, plus per-uid metadata, so the "Preserve & Rerun" flow can show a side-by-side diff.
- **Rerun spawner** (`runner.ts`) — spawns the user's `wdio` / `nightwatch` / `selenium` binary with rerun filters built from the dashboard's payload.
- **Worker-message handler** — dispatches messages from spawned workers (config path, session id, video path, ...).
- **Trace serving** (`show-trace.ts`, `trace-reader.ts`) — reconstructs a recorded `trace.zip` and boots the server in a read-only **trace-serve** mode that backs the DevTools UI's trace player. No worker connects in this mode.

## Framework awareness

Lives only in `runner.ts` and `framework-filters.ts`. Both branch on a typed `TestRunnerId` from `@wdio/devtools-shared` (never a magic string). `framework-filters.ts` uses an explicit `switch` over the runner id rather than a Map/object lookup so CodeQL's `unvalidated-dynamic-method-call` query trusts the dispatch.

## Trace serving / `show-trace`

Trace mode (see the [root README](../../README.md#-trace-mode-tracezip)) writes a portable `trace.zip`; the backend is what opens it back up.

- **CLI** (`src/show-trace.ts`) — `runShowTraceCli` resolves the argument, reads the archive with `readTraceZip`, calls `start({ trace })` in trace-serve mode, prints the URL, and opens the default browser. Run it from this repo with the root script:

  ```sh
  pnpm show-trace path/to/trace.zip
  ```

  The same entry is shipped as a `show-trace` **bin** by the backend (`./dist/show-trace.js`) and by each adapter (`@wdio/devtools-service`, `@wdio/selenium-devtools`, `@wdio/nightwatch-devtools` each ship a thin `bin/show-trace.mjs`), so `npx show-trace <trace.zip>` works in any project that installs an adapter — backend need only be a transitive dependency. In trace-serve mode `start({ trace })` exposes the reconstructed payload at `TRACE_API.get` and skips the worker/rerun machinery. It is one of the backend's two bins; the other, `devtools-backend` (`./dist/server.js`), starts the live dashboard server described under [Public API](#public-api).

- **Reader** (`src/trace-reader.ts`, with sibling `trace-reader-{constants,types,utils,groups}.ts`) — `parseTraceZip` / `readTraceZip` reconstruct a `TracePlayerData` payload from the archive. It accepts this repo's own exporter output **and foreign zips** written by other tools (every `.trace` entry is an action-event stream, every `.network` a HAR stream, `.stacks` sidecars carry call stacks). It rebuilds:
  - **commands** — from `before`/`after` action events, with call source, result, error, nearest screenshot frame, and pointer hit point;
  - **DOM mutations** — from the `.mutations` NDJSON stream (drives the player's DOM time-travel);
  - **network** — HAR entries from `.network` streams;
  - **console** — from `console`/`stdout`/`stderr` events;
  - **a11y snapshots** — the per-action `-snapshot.txt` accessibility tree, keyed onto each command's `snapshotText` (drives the A11y tab);
  - **transcript** — `transcript.md`, surfaced verbatim in the player's Transcript tab;
  - plus the filmstrip frames, sources, and the `tracingGroup` action tree (Feature → Scenario → Step nesting).

Because the archive uses that portable, standard trace-viewer format, the same `.zip` also opens in compatible standalone trace viewers, and its on-disk format is what an Allure report's **embedded trace viewer** reads (Allure ≥ 2.35).

## Public API

Two build entries, and they are deliberately separate files.

- **Library entry** (`src/index.ts` → `dist/index.js`), consumed in-process by the other workspace packages: adapter launchers call `start({ port, hostname })` and receive the bound port, then `stop()` on teardown. The dashboard accesses the running server via the documented HTTP routes (`packages/shared/src/baseline.ts`, `packages/shared/src/runner.ts`) and WS scopes (`packages/shared/src/ws.ts`, `packages/shared/src/routes.ts`).

- **CLI entry** (`src/server.ts` → the executable `dist/server.js`), shipped as the `devtools-backend` bin, which starts the same server on its own instead of from an adapter's launcher:

  ```sh
  npx @wdio/devtools-backend --port 8080 --hostname 0.0.0.0
  ```

  - `--port <number>` (or `--port=<number>`): preferred port; a free one is chosen if it's taken.
  - `--hostname <host>` (or `--hostname=<host>`): host to bind, `localhost` by default.
  - `-h`, `--help`: print usage and exit without starting.

Don't collapse the CLI back into `index.ts` behind a "start if run directly" guard: `show-trace.ts` imports `start` from index, which makes index a shared module whose body tsup hoists into `dist/chunk-*.js`, and there `import.meta.url` is the chunk's own path and can never equal `process.argv[1]`, so the guard is dead in every build (`node dist/index.js` exited 0 without ever serving); a leaf entry keeps its body in its own output file, which is why `show-trace.js` self-starts correctly.

For the full picture of how events flow adapter → backend → dashboard, see [ARCHITECTURE.md](../../ARCHITECTURE.md).
