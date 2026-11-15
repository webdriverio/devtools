# backend — design notes and known debt

Owns the dashboard server and the WS/HTTP contracts it serves, and builds trace zips with `trace`'s writer (`packages/backend/src`).

Framework-specific behavior in the backend is contained in two files: `runner.ts` and `framework-filters.ts`. Both branch on a typed `TestRunnerId` from shared, never on a magic string. The `framework-filters` dispatch is a `switch` over `TestRunnerId` (not a table lookup) so CodeQL's `unvalidated-dynamic-method-call` query trusts the call site.

## Design notes

- **Preserve & Rerun needs no adapter code; it is gated on run capabilities.** The button renders on `hasFailed && !runDisabled`, so an adapter advertising no run capabilities never showed it; `baselineStore` snapshots from the stream every adapter already sends, and `toMs` accepts the ISO strings Python puts on `SuiteStats.start`/`end`. Verified end-to-end against a live backend with frames built by the adapter's own `frames`/`SessionCapturer`: both attempts carried their commands, console and network with distinct windows and correct states. `preserveBaseline` is the one flag deciding whether the request that exists to compare wipes what it means to compare against; `packages/backend/tests/preserve-across-rerun.test.ts` holds it. Preserved attempts live in `#baselines`, outside the `#activeRun` accumulator, which is why a rerun's new run id resets capture without losing the snapshot — and why the order matters: preserving *after* a new run connects is a deliberate 409.

- **A rerun does not travel down the worker socket.** `POST /api/tests/run` spawns a fresh process; the socket carries only `clientConnected`/`clientDisconnected`. So the single-`workerSocket` limitation is about which process the *dashboard state* belongs to under `pytest -n`, not about routing the rerun.

## Known debt

- **A tsup entry that another entry imports is not a leaf, so an `import.meta.url === process.argv[1]` self-start check inside it is dead code; a CLI has to be its own leaf entry.** tsup hoists a module body shared by two entries into `dist/chunk-*.js`, and there `import.meta.url` is the chunk's path, which can never equal `process.argv[1]`. `packages/backend/src/show-trace.ts` imports `start` from `index.ts`, which is what made index shared, so a "start if run directly" guard in index is dead in every build (`node dist/index.js` exits 0 without serving), while `dist/show-trace.js` self-starts because it is a leaf whose body stays in its own output file (it also compares realpaths, because the invoked path is the `node_modules/.bin` symlink). The live dashboard server is therefore its own leaf entry, `packages/backend/src/server.ts` (shebang, built to an executable `dist/server.js`, shipped as the `devtools-backend` bin, accepting `--port`, `--hostname`, `-h`/`--help`), and `index.ts` stays library-only for the three adapters' in-process `start`/`stop`. Same family as the `cucumberHooks.cts` entry in `packages/nightwatch-devtools/CLAUDE.md`: the tsup entry list is part of the contract, and in both cases a wrong entry list fails silently rather than with an error.

## Test coverage gaps (worst-risk-first)

- `packages/backend/src/baselineStore.ts` — **91%**. Remaining 9% is leaf-error paths.
