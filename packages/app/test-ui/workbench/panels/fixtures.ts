// Console-log and network-request scenarios for the two data-heavy workbench
// panels. Both take their data through @lit/context, so a spec hands these
// arrays to `mountWithContext` rather than setting properties.
//
// Typed against shared's `ConsoleLog`/`NetworkRequest` — the contracts the
// adapters produce. The panels annotate the same data with the browser-side
// globals of the same name, which resolve to `any` in this program
// (packages/script/types.d.ts aliases both to themselves), so shared is the
// only shape that actually type-checks a fixture.

import type { ConsoleLog, NetworkRequest } from '@wdio/devtools-shared'

/** Wall-clock origin of the fixture run — the offsets below read as ms into it. */
export const RUN_START = 1_700_000_000_000

export function consoleLog(overrides: Partial<ConsoleLog> = {}): ConsoleLog {
  return {
    type: 'log',
    args: ['log line'],
    timestamp: RUN_START,
    ...overrides
  }
}

export function networkRequest(
  overrides: Partial<NetworkRequest> = {}
): NetworkRequest {
  return {
    id: 'req-1',
    url: 'https://the-internet.herokuapp.com/login',
    method: 'GET',
    type: 'document',
    status: 200,
    timestamp: RUN_START,
    startTime: RUN_START,
    ...overrides
  }
}

/** `runnerWarn`'s message once the panel has stripped its SGR codes. */
export const RUNNER_WARN_TEXT = '[WARN] retrying assertion on #flash'

/** Wider than the message column by two orders of magnitude — the panel wraps
 *  it (CSS `pre-wrap`/`break-word`) and never shortens the text. */
export const LONG_CONSOLE_MESSAGE = `Unhandled rejection: ${'at Object.<anonymous> (login.e2e.ts:42:7) '.repeat(
  40
)}`

export interface LoginConsole {
  /** Capture order, which is the order the panel renders. */
  logs: ConsoleLog[]
  /** Page-side `console.log`, and the run's first entry — elapsed origin. */
  pageLog: ConsoleLog
  /** Spec-side log, 0.4s in. */
  testInfo: ConsoleLog
  /** Runner stdout, 1.2s in, carrying the SGR residue a coloured logger leaves. */
  runnerWarn: ConsoleLog
  /** Page-side error, 2.5s in. */
  pageError: ConsoleLog
}

const pageLog = consoleLog({
  type: 'log',
  args: ['[TEST] logging in with valid credentials'],
  source: 'browser',
  timestamp: RUN_START
})

const testInfo = consoleLog({
  type: 'info',
  args: ['navigating to /secure'],
  source: 'test',
  timestamp: RUN_START + 400
})

// The `\u001b` prefixes are load-bearing: `stripAnsi` matches `ESC[<n>m`, so a
// colour code that reached the app without its ESC stays in the rendered row.
const runnerWarn = consoleLog({
  type: 'warn',
  args: ['\u001b[33m[WARN]\u001b[39m retrying assertion on #flash'],
  source: 'terminal',
  timestamp: RUN_START + 1200
})

const pageError = consoleLog({
  type: 'error',
  args: ["TypeError: Cannot read properties of undefined (reading 'flash')"],
  source: 'browser',
  timestamp: RUN_START + 2500
})

export const loginConsole: LoginConsole = {
  logs: [pageLog, testInfo, runnerWarn, pageError],
  pageLog,
  testInfo,
  runnerWarn,
  pageError
}

export interface LoginNetwork {
  /** Capture order, which is the order the panel renders. */
  requests: NetworkRequest[]
  /** Slowest at 800ms, so its bar fills the track; HTML by content-type. */
  pageHtml: NetworkRequest
  /** Half the slowest, so a half-width bar; JS by content-type. */
  script: NetworkRequest
  /** POST with headers and JSON bodies on both sides — drives the detail panel.
   *  At 8ms it is also the request that needs the bar's minimum width. */
  api: NetworkRequest
  /** 404 with no response headers: typed by URL extension, size unknown. */
  missingImage: NetworkRequest
  /** Transport failure — no status, an `error`, still timed. */
  failedFont: NetworkRequest
  /** 3xx, the one request in the redirect status bucket. */
  redirect: NetworkRequest
  /** In flight: no status, no timing, no size, no headers. */
  pending: NetworkRequest
}

const pageHtml = networkRequest({
  id: 'req-html',
  url: 'https://the-internet.herokuapp.com/login',
  type: 'document',
  status: 200,
  statusText: 'OK',
  requestHeaders: { accept: 'text/html' },
  responseHeaders: { 'content-type': 'text/html; charset=utf-8' },
  size: 12_288,
  time: 800,
  timestamp: RUN_START,
  startTime: RUN_START,
  endTime: RUN_START + 800
})

const script = networkRequest({
  id: 'req-js',
  url: 'https://the-internet.herokuapp.com/js/vendor/jquery-1.11.3.min.js',
  type: 'script',
  status: 200,
  statusText: 'OK',
  responseHeaders: { 'content-type': 'application/javascript' },
  size: 240_000,
  time: 400,
  timestamp: RUN_START + 820,
  startTime: RUN_START + 820,
  endTime: RUN_START + 1220
})

const api = networkRequest({
  id: 'req-api',
  url: 'https://the-internet.herokuapp.com/api/session',
  method: 'POST',
  type: 'fetch',
  status: 200,
  statusText: 'OK',
  requestHeaders: { 'content-type': 'application/json' },
  responseHeaders: { 'content-type': 'application/json' },
  requestBody: '{"sku":"AB-1","qty":2}',
  responseBody: '{"ok":true,"items":2}',
  size: 320,
  time: 8,
  timestamp: RUN_START + 1300,
  startTime: RUN_START + 1300,
  endTime: RUN_START + 1308
})

const missingImage = networkRequest({
  id: 'req-img',
  url: 'https://the-internet.herokuapp.com/img/missing-avatar.png',
  type: 'image',
  status: 404,
  statusText: 'Not Found',
  time: 120,
  timestamp: RUN_START + 1500,
  startTime: RUN_START + 1500,
  endTime: RUN_START + 1620
})

const failedFont = networkRequest({
  id: 'req-font',
  url: 'https://the-internet.herokuapp.com/fonts/inter.woff2',
  type: 'font',
  status: undefined,
  error: 'net::ERR_CONNECTION_REFUSED',
  time: 200,
  timestamp: RUN_START + 1700,
  startTime: RUN_START + 1700,
  endTime: RUN_START + 1900
})

const redirect = networkRequest({
  id: 'req-redirect',
  url: 'https://the-internet.herokuapp.com/authenticate',
  type: 'document',
  status: 302,
  statusText: 'Found',
  time: 40,
  timestamp: RUN_START + 1900,
  startTime: RUN_START + 1900,
  endTime: RUN_START + 1940
})

const pending = networkRequest({
  id: 'req-pending',
  url: 'https://the-internet.herokuapp.com/api/notifications?limit=4',
  type: 'fetch',
  status: undefined,
  timestamp: RUN_START + 2100,
  startTime: RUN_START + 2100
})

export const loginNetwork: LoginNetwork = {
  requests: [
    pageHtml,
    script,
    api,
    missingImage,
    failedFont,
    redirect,
    pending
  ],
  pageHtml,
  script,
  api,
  missingImage,
  failedFont,
  redirect,
  pending
}
