# @wdio/devtools-backend

The server that the three adapter packages connect to and the dashboard UI talks to. Internal to the monorepo — not published.

## Responsibilities

- **Fastify HTTP server** — REST endpoints for preserve/clear/run/stop and the dashboard's baseline pair lookups.
- **WebSocket gateway** — one connection per adapter worker, one per dashboard client. Adapter events fan out to every connected dashboard.
- **Baseline store** (in-memory) — captures a snapshot of a failing test attempt, plus per-uid metadata, so the "Preserve & Rerun" flow can show a side-by-side diff.
- **Rerun spawner** (`runner.ts`) — spawns the user's `wdio` / `nightwatch` / `selenium` binary with rerun filters built from the dashboard's payload.
- **Worker-message handler** — dispatches messages from spawned workers (config path, session id, video path, ...).

## Framework awareness

Lives only in `runner.ts` and `framework-filters.ts`. Both branch on a typed `TestRunnerId` from `@wdio/devtools-shared` (never a magic string). `framework-filters.ts` uses an explicit `switch` over the runner id rather than a Map/object lookup so CodeQL's `unvalidated-dynamic-method-call` query trusts the dispatch.

## Public API

The backend is consumed only by other workspace packages. Adapter launchers call `start({ port, hostname })` and receive the bound port. The dashboard accesses it via the documented HTTP routes (`packages/shared/src/baseline.ts`, `packages/shared/src/runner.ts`) and WS scopes (`packages/shared/src/ws.ts`, `packages/shared/src/routes.ts`).

For the full picture of how events flow adapter → backend → dashboard, see [ARCHITECTURE.md](../../ARCHITECTURE.md).
