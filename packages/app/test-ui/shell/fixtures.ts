// Inputs for the app-shell specs. Everything here is a WIRE shape — a `suites`
// WS frame, a `metadata` frame, the trace zip the backend serves in trace-serve
// mode, so a spec drives the real DataManager/component derivation instead of
// hand-building the state those paths are supposed to produce.

import {
  ACTION_MAP,
  TRACE_API,
  TraceType,
  traceZipUrl,
  WS_PATHS
} from '@wdio/devtools-shared'
import type { CommandLog, Metadata, TraceLog } from '@wdio/devtools-shared'

import { storedZip } from '../support/trace-archive.js'

import type {
  SuiteStatsFragment,
  TestStatsFragment
} from '@/controller/types.js'

/** The project's standing demo target. */
export const LOGIN_URL = 'https://the-internet.herokuapp.com/login'
export const SECURE_URL = 'https://the-internet.herokuapp.com/secure'

export const SPEC_FILE = '/repo/test/login.e2e.ts'
export const SESSION_ID = 'session-shell-1'

/** The shell only checks *whether* a test carries an `end` stamp. */
const FINISHED_AT = new Date(1_700_000_000_000)
const RUN_START = 1_700_000_000_000

function testFragment(
  uid: string,
  title: string,
  overrides: Omit<Partial<TestStatsFragment>, 'uid' | 'title'> = {}
): TestStatsFragment & { title: string } {
  return { uid, title, fullTitle: title, file: SPEC_FILE, ...overrides }
}

/** `tests` is defaulted rather than omitted: the sidebar tells a suite from a
 *  test with `'tests' in entry`, so a fragment without the key reads as a leaf.
 *  Real `SuiteStats` always carries the array. */
function suiteFragment(
  uid: string,
  title: string,
  overrides: Omit<Partial<SuiteStatsFragment>, 'uid' | 'title'> = {}
): SuiteStatsFragment & { title: string } {
  return {
    uid,
    title,
    fullTitle: title,
    file: SPEC_FILE,
    tests: [],
    ...overrides
  }
}

/** The `suites` frame shape: uid-keyed chunks, one entry per registered suite. */
export function suiteRegistry(
  ...suites: SuiteStatsFragment[]
): Record<string, SuiteStatsFragment>[] {
  return [Object.fromEntries(suites.map((suite) => [suite.uid, suite]))]
}

const LOGIN_TITLE = 'Login page'

const passing = testFragment('login-valid', 'signs in with valid credentials', {
  state: 'passed',
  end: FINISHED_AT
})

const failing = testFragment('login-flash', 'shows the flash message', {
  state: 'failed',
  end: FINISHED_AT
})

const running = testFragment('login-logout', 'logs out again', {
  state: 'running'
})

const skipped = testFragment('login-remember', 'remembers the session', {
  state: 'skipped'
})

const loginSuite = suiteFragment('login-suite', LOGIN_TITLE, {
  tests: [passing, failing, running, skipped]
})

/** One root suite carrying every per-test state the sidebar renders. No two
 *  titles share a distinctive word, so a filter assertion has one right answer
 *  and the suite title matches none of its own tests. */
export const loginRun = {
  /** The payload of a `suites` WS frame. */
  frame: suiteRegistry(loginSuite),
  suite: loginSuite,
  passing,
  failing,
  running,
  skipped,
  /** Row labels top to bottom: the root suite, then its tests in frame order. */
  rowLabels: [
    LOGIN_TITLE,
    passing.title,
    failing.title,
    running.title,
    skipped.title
  ]
}

/** The payload of a `metadata` WS frame for a live testrunner session. */
export const testrunnerMetadata: Metadata = {
  type: TraceType.Testrunner,
  url: LOGIN_URL,
  sessionId: SESSION_ID,
  options: {
    framework: 'mocha',
    configFilePath: '/repo/wdio.conf.ts'
  }
}

/** A standalone (non-testrunner) capture — the shell renders no test tree. */
export const standaloneMetadata: Metadata = {
  type: TraceType.Standalone,
  url: LOGIN_URL,
  sessionId: SESSION_ID
}

/** Two commands a keyboard step can walk between, 800ms apart. */
export const loginCommands: CommandLog[] = [
  {
    command: 'url',
    args: [LOGIN_URL],
    timestamp: RUN_START
  },
  {
    command: 'click',
    args: ['#login button'],
    timestamp: RUN_START + 800
  }
]

export function traceLog(overrides: Partial<TraceLog> = {}): TraceLog {
  return {
    mutations: [],
    logs: [],
    consoleLogs: [],
    networkRequests: [],
    metadata: testrunnerMetadata,
    commands: loginCommands,
    sources: {},
    // A fragment stands in for the full SuiteStats: the app reads only these fields.
    suites: loginRun.frame as TraceLog['suites'],
    ...overrides
  }
}

/** A trace zip of `commands` recorded by a testrunner, as `show-trace` serves it. */
export function traceZip(commands: CommandLog[] = loginCommands): Blob {
  const events: Record<string, unknown>[] = [
    {
      type: 'context-options',
      wallTime: RUN_START,
      monotonicTime: 0,
      browserName: 'chrome',
      runner: 'mocha'
    }
  ]
  commands.forEach((command, index) => {
    const action = ACTION_MAP[command.command]!
    const callId = `call@${index + 1}`
    const at = command.timestamp - RUN_START
    events.push(
      {
        type: 'before',
        callId,
        startTime: at,
        class: action.class,
        method: action.method,
        params: { 0: command.args[0] }
      },
      { type: 'after', callId, endTime: at }
    )
  })
  return storedZip({
    'trace.trace': events.map((event) => JSON.stringify(event)).join('\n')
  })
}

export interface RecordedRequest {
  url: string
  body: Record<string, unknown>
}

/** The dashboard's `/client` socket. The app subscribes on `open` only, so a
 *  frame sent before `open()` is deliberately unobserved. */
export class FakeClientSocket extends EventTarget {
  readonly url: string
  closed = false

  constructor(url: string) {
    super()
    this.url = url
  }

  close(): void {
    this.closed = true
  }

  open(): void {
    this.dispatchEvent(new Event('open'))
  }

  /** Simulate a failed upgrade — the app then falls back to its cached trace. */
  fail(): void {
    this.dispatchEvent(new Event('error'))
  }

  send(scope: string, data: unknown): void {
    this.dispatchEvent(
      new MessageEvent('message', { data: JSON.stringify({ scope, data }) })
    )
  }
}

export interface FakeBackend {
  /** Every `/client` socket the app opened, newest last. */
  sockets: FakeClientSocket[]
  /** POSTs the shell's children made to `/api/*`. */
  requests: RecordedRequest[]
  restore(): void
}

/** What `show-trace` serves: its zips, and how many times each may be fetched before the backend fails it. */
export interface ServedZips {
  zips: Blob[]
  /** Fetches each zip answers before it answers 500 instead. */
  fetchesBeforeFailing?: number
}

/** What trace-serve mode answers at `url`: the zips as a run, or nothing to serve; undefined for any other route. */
function traceServeResponse(
  url: string,
  served: ServedZips | undefined,
  fetches: number[]
): Response | undefined {
  const zips = served?.zips ?? []
  if (url === TRACE_API.run) {
    return zips.length
      ? Response.json({
          traces: zips.map((_, i) => ({
            path: `run/t${i}/trace.zip`,
            url: traceZipUrl(i)
          }))
        })
      : // 204: the route exists in live mode but serves no trace.
        new Response(null, { status: 204 })
  }
  if (url === TRACE_API.get) {
    return new Response(null, { status: 204 })
  }
  const index = zips.findIndex((_, i) => url === traceZipUrl(i))
  if (index === -1) {
    return undefined
  }
  fetches[index] = (fetches[index] ?? 0) + 1
  return fetches[index]! > (served?.fetchesBeforeFailing ?? Infinity)
    ? new Response(null, { status: 500 })
    : new Response(zips[index])
}

/**
 * Stands in for the backend the app boots against: the listing at
 * TRACE_API.run decides player vs live mode, and the `/client` upgrade is where
 * live data arrives. Only those two (and the listed zip) are intercepted:
 * every other request and socket goes to the real implementation, because the
 * component runner serves the spec itself over both.
 */
export function installFakeBackend(
  options: { served?: ServedZips } = {}
): FakeBackend {
  const fetches: number[] = []
  const nativeFetch = globalThis.fetch
  const NativeSocket = globalThis.WebSocket
  const backend: FakeBackend = {
    sockets: [],
    requests: [],
    restore() {
      globalThis.fetch = nativeFetch
      globalThis.WebSocket = NativeSocket
    }
  }

  globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(
      typeof input === 'string' ? input : (input as Request).url
    )
    const served = traceServeResponse(url, options.served, fetches)
    if (served) {
      return Promise.resolve(served)
    }
    if (url.startsWith('/api/')) {
      backend.requests.push({
        url,
        body: init?.body
          ? (JSON.parse(String(init.body)) as Record<string, unknown>)
          : {}
      })
      return Promise.resolve(new Response('{}', { status: 200 }))
    }
    return nativeFetch(input, init)
  }

  // A Proxy rather than a subclass so the runner's own sockets keep the real
  // constructor, statics and prototype.
  globalThis.WebSocket = new Proxy(NativeSocket, {
    construct(target, args: [string, (string | string[])?]) {
      if (!String(args[0]).endsWith(WS_PATHS.client)) {
        return new target(...args)
      }
      const socket = new FakeClientSocket(String(args[0]))
      backend.sockets.push(socket)
      return socket as unknown as WebSocket
    }
  })

  return backend
}

/** One macrotask — enough for the awaited trace probe inside the boot path. */
export const flush = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 0))

/** Wait for a condition the boot path reaches asynchronously. */
export async function waitFor(
  predicate: () => boolean,
  what: string
): Promise<void> {
  // Bounded by time, not ticks: opening a served zip loads the reader on demand.
  const deadline = Date.now() + 4000
  while (Date.now() < deadline && !predicate()) {
    await flush()
  }
  if (!predicate()) {
    throw new Error(`timed out waiting for ${what}`)
  }
}

/** The app's live socket, opened — the point at which it reports a connection. */
export async function openClientSocket(
  backend: FakeBackend
): Promise<FakeClientSocket> {
  await waitFor(() => backend.sockets.length > 0, 'the app to open /client')
  const socket = backend.sockets[backend.sockets.length - 1]
  socket.open()
  return socket
}
