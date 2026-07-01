# Python spike — Phase 0 feasibility proof

Proves that a **non-JS client** can drive the DevTools dashboard with no
backend or UI changes. A dependency-free Python script speaks the adapter side
of the wire (raw socket + RFC-6455 handshake) and pushes the same
`{ "scope", "data" }` frames the JS Selenium adapter emits.

This is a throwaway spike, not the adapter. Its job is to de-risk everything
downstream and to capture the **golden frames** the real Python adapter must
reproduce.

## Result

✅ **Boundary proven end to end.** Every data scope the dashboard consumes
(`metadata`, `suites`, `commands`, `consoleLogs`, `networkRequests`) was sent
from Python and observed arriving at a dashboard-role `/client` subscriber.

## Run it

```bash
# 1. build once (from repo root)
pnpm --filter @wdio/devtools-app --filter @wdio/devtools-backend build

# 2. start the backend + dashboard
node packages/backend/dist/index.js
#    note the port it logs — 3000 if free, else a negotiated port e.g. 63763

# 3a. visual check: open the dashboard, then run the spike
#     (export the port if it isn't 3000)
DEVTOOLS_PORT=63763 python3 examples/python-spike/spike.py
#     → a "Python spike" suite, a command timeline, console + network appear live

# 3b. headless proof (no browser): run the listener, then the spike
DEVTOOLS_PORT=63763 node examples/python-spike/verify-client.mjs &
DEVTOOLS_PORT=63763 python3 examples/python-spike/spike.py
#     → listener prints "✓ all expected scopes received — boundary proven"
```

## What this established (the contract a Python adapter must honor)

- **Endpoint.** Adapters connect to `ws://<host>:<port>/worker`. The dashboard
  subscribes to `/client`. No handshake, auth, or session registration — the
  backend parses each frame and broadcasts it verbatim
  (`packages/backend/src/worker-message-handler.ts`).
- **Frame envelope.** `{ "scope": string, "data": <payload> }`, one JSON object
  per WS text frame. `data` must be truthy or the UI drops it
  (`DataManager.ts:308`).
- **Data scopes the UI renders** (`DataManager.ts:283-302`):
  | scope | payload | notes |
  |---|---|---|
  | `metadata` | `Metadata` object | `type: "testrunner"`, carries `sessionId` |
  | `suites` | `SuiteStats[]` | the test tree; re-send to update final state |
  | `commands` | `CommandLog[]` | send incrementally for a live timeline |
  | `consoleLogs` | `ConsoleLog[]` | `source: "browser" \| "test" \| "terminal"` |
  | `networkRequests` | `NetworkRequest[]` | |
- **Field shapes** mirror `packages/shared/src/types.ts`. Two encoding rules
  learned here:
  - timestamps are **epoch milliseconds** (numbers).
  - `SuiteStats.start/end` are TS `Date`s — they cross the wire as **ISO
    strings**.
- **Port negotiation.** If 3000 is busy the backend uses `get-port` and logs the
  real port. The JS adapters read it from `start()`'s return value; the Python
  adapter will need the same (env var / discovery).
- **Replay buffer.** The backend buffers broadcast frames and replays them to
  late-connecting clients — a dashboard opened mid-run catches up. The Python
  adapter gets this for free.

## Files

- `spike.py` — dependency-free worker client + golden frames.
- `verify-client.mjs` — `/client` subscriber that asserts the frames fan out.

## Not covered by this spike (later phases)

Driver instrumentation (`execute()` wrap), BiDi console/network, screencast,
pytest lifecycle, trace export — see the Phase roadmap. This spike only proves
the transport boundary, which everything else depends on.
