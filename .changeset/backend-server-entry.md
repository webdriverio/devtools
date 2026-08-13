---
"@wdio/devtools-backend": minor
---

The backend ships a runnable entry, so a non-Node adapter can start the dashboard itself.

- `dist/server.js` is a new CLI entry, exposed as the `devtools-backend` bin. `node packages/backend/dist/server.js` and `npx @wdio/devtools-backend` both start the live dashboard, and `--port` / `--hostname` / `--help` are accepted.
- `dist/index.js` stays the library entry the JS adapters import in-process. Its "start if run directly" guard is gone rather than repaired: `show-trace.ts` imports `start` from index, which makes index a shared module whose body tsup hoists into `dist/chunk-*.js`, and there `import.meta.url` is the chunk's path and can never equal `process.argv[1]`. The guard was therefore dead in every build, which is why `node dist/index.js` imported a module and exited 0 without serving. A leaf entry keeps its body in its own output file, so the new file needs no guard at all.
- `dev:app` now runs `dist/server.js`, since it was watching an entry that could not start.
