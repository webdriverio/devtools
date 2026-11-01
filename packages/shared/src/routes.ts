/**
 * WebSocket upgrade paths on the backend's Fastify server. Each adapter opens
 * one socket at `worker`; one or more browser tabs subscribe at `client`.
 *
 * The HTTP API endpoints under `/api/baseline/*` live in `./baseline.ts`.
 */
export const WS_PATHS = {
  /** Adapter session upgrade endpoint. One socket per running adapter. */
  worker: '/worker',
  /** App/UI client upgrade endpoint. Multiple browser tabs may connect. */
  client: '/client'
} as const

/**
 * Query params on the worker upgrade. Both answer the same question for the
 * backend — does this socket continue the current run, or start a new one? —
 * which decides whether accumulated run state is kept or wiped. A run opens
 * one worker socket per spec file, so treating every connect as a new run
 * drops earlier specs' data and Preserve & Rerun then has nothing to diff.
 */
export const WORKER_WS_QUERY = {
  /** `1` when the adapter reopened this socket mid-run (e.g. after a session
   *  change from `browser.end()` or `reloadSession()`). */
  reconnect: 'reconnect',
  /** Identity of the run this worker belongs to; shared by every worker the
   *  same run forks. */
  runId: 'runId'
} as const

/**
 * Control-frame scopes exchanged over the worker↔backend↔client WS channels.
 * `BASELINE_WS_SCOPE` (in `./baseline.ts`) covers the baseline-specific
 * scopes; this object covers the runtime control frames. Single source of
 * truth — typos previously caused silent breakage when one end of the wire
 * sent a string the other end didn't recognize.
 */
export const WS_SCOPE = {
  /** Backend → worker: a dashboard client has subscribed. Wakes up the
   *  adapter's `await UI ready` gate before tests start. */
  clientConnected: 'clientConnected',
  /** Backend → worker: the last dashboard tab closed. Triggers the
   *  interactive shutdown flow (close WS, exit, pkill the dashboard). */
  clientDisconnected: 'clientDisconnected',
  /** Worker → backend → clients (or app-local): wipe the visualization data
   *  for a specific test/suite uid (or the whole tree). */
  clearExecutionData: 'clearExecutionData',
  /** Worker → backend: clear-by-test-uid request (drives clearExecutionData). */
  clearCommands: 'clearCommands',
  /** Backend → clients: signal that the active run was stopped by the UI. */
  testStopped: 'testStopped',
  /** Worker → backend → clients: swap an earlier captured command for an
   *  updated entry (used when a retry coalesces commands). */
  replaceCommand: 'replaceCommand',
  /** Worker → backend: register the config file path so reruns can spawn
   *  with the same config. */
  config: 'config'
} as const

export type WsScope = (typeof WS_SCOPE)[keyof typeof WS_SCOPE]
