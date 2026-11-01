/**
 * Cross-adapter timing + identifier defaults.
 *
 * The TIMING values are wall-clock milliseconds the adapter's plugin loop
 * waits for (UI render, test/suite boundaries, browser close, WS connection
 * setup). The DEFAULTS provide the canonical TestStats / SuiteStats field
 * defaults so every adapter produces the same shape on the wire.
 *
 * Adapters spread these into their local TIMING / DEFAULTS objects so they
 * can override per-framework values (Nightwatch's UI_CONNECTION_WAIT is
 * higher because its boot is slower; each adapter has its own SESSION_TITLE
 * / TEST_NAME placeholder).
 */

export const TIMING_BASE = {
  /** ms to let the dashboard render between rapid state updates. */
  UI_RENDER_DELAY: 150,
  /** ms to wait after a test starts before flushing initial state. */
  TEST_START_DELAY: 100,
  /** ms gap between consecutive suite-finalize broadcasts. */
  SUITE_COMPLETE_DELAY: 200,
  /** ms allowed for the browser-close handshake before forcing teardown. */
  BROWSER_CLOSE_WAIT: 2000,
  /** ms before first worker WS connection attempt — lets backend bind. */
  INITIAL_CONNECTION_WAIT: 500,
  /** ms between browser-window-alive polls. */
  BROWSER_POLL_INTERVAL: 1000
} as const

export const DEFAULTS_BASE = {
  /** Synthetic capability ID — present on every CommandLog / TestStats. */
  CID: '0-0',
  /** TestStats.retries default — adapters that surface retry counts override. */
  RETRIES: 0,
  /** _duration placeholder for not-yet-finalized stats. */
  DURATION: 0
} as const
