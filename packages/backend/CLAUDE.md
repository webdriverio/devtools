# backend — design notes and known debt

Owns the dashboard server and the WS/HTTP contracts it serves, and builds trace zips with `trace`'s writer (`packages/backend/src`).

Framework-specific behavior is contained in `runner.ts` and `framework-filters.ts`. Both branch on a typed `TestRunnerId` from shared, never on a magic string.

## Design notes

- **Preserve & Rerun is gated on run capabilities, with no adapter code.** The button renders on `hasFailed && !runDisabled`, so an adapter advertising no run capabilities never shows it. `preserveBaseline` decides whether the rerun wipes the baseline it compares against; `packages/backend/tests/preserve-across-rerun.test.ts` holds it. Preserved attempts live in `#baselines`, outside the `#activeRun` accumulator. Preserving after a new run connects is a deliberate 409.
- **A rerun does not travel down the worker socket.** `POST /api/tests/run` spawns a fresh process, and the socket carries only `clientConnected`/`clientDisconnected`. The single `workerSocket` limit is about which process owns dashboard state under `pytest -n`.
- Don't turn the `framework-filters` dispatch into a table lookup. It is a `switch` over `TestRunnerId` so CodeQL's `unvalidated-dynamic-method-call` query trusts the call site.

## Known debt

- **A CLI must be its own tsup leaf entry.** tsup hoists a module body shared by two entries into `dist/chunk-*.js`, where `import.meta.url` never equals `process.argv[1]`. `show-trace.ts` imports `start` from `index.ts`, which made index shared, so a "start if run directly" guard in `index.ts` is dead in every build. The live server is therefore its own leaf, `packages/backend/src/server.ts` (built to `dist/server.js`, shipped as the `devtools-backend` bin); `index.ts` stays library-only. A wrong tsup entry list fails silently, not with an error.
