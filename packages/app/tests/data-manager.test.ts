// @vitest-environment happy-dom
//
// DataManagerController is the app's state hub: every panel reads it through a
// `@lit/context` provider, and everything it publishes arrives as a WS frame.
// So the tests drive it the way the backend does — a socket message in, a
// provider value out — rather than calling its private handlers. The socket and
// the trace-probe fetch are the only two things stubbed; the rest of the path
// (parse → scope dispatch → merge helpers → provider) is the real code.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactiveController, ReactiveControllerHost } from 'lit'
import {
  BASELINE_WS_SCOPE,
  TRACE_API,
  TraceType,
  WS_SCOPE,
  type CommandLog,
  type NetworkRequest,
  type PreservedAttempt,
  type TraceLog,
  type TracePlayerData,
  type WsMessageScope
} from '@wdio/devtools-shared'

import { CACHE_ID } from '../src/controller/constants.js'
import { DataManagerController } from '../src/controller/DataManager.js'
import { rerunState } from '../src/controller/rerunState.js'
import type {
  SuiteStatsFragment,
  TestStatsFragment
} from '../src/controller/types.js'

const LOGIN_URL = 'https://the-internet.herokuapp.com/login'
const RUN_START = 1_700_000_000_000
const SESSION = 'session-a'

/** Host stand-in: a real element (the providers listen on it) that never runs
 *  the controller lifecycle itself, so each test decides when to connect. */
class StubHost extends HTMLElement implements ReactiveControllerHost {
  readonly controllers: ReactiveController[] = []
  updateRequests = 0

  addController(controller: ReactiveController) {
    this.controllers.push(controller)
  }

  removeController(controller: ReactiveController) {
    const index = this.controllers.indexOf(controller)
    if (index !== -1) {
      this.controllers.splice(index, 1)
    }
  }

  requestUpdate() {
    this.updateRequests++
  }

  get updateComplete(): Promise<boolean> {
    return Promise.resolve(true)
  }
}
customElements.define('data-manager-stub-host', StubHost)

/** Stands in for the backend's `/client` socket: the controller attaches its
 *  message listener on `open`, so frames are only delivered after that. */
class FakeSocket {
  static opened: FakeSocket[] = []
  readonly #listeners = new Map<string, ((event: unknown) => void)[]>()
  closed = false

  constructor(readonly url: string) {
    FakeSocket.opened.push(this)
  }

  addEventListener(type: string, listener: (event: unknown) => void) {
    this.#listeners.set(type, [...(this.#listeners.get(type) ?? []), listener])
  }

  removeEventListener() {}

  close() {
    this.closed = true
  }

  #emit(type: string, event: unknown) {
    for (const listener of this.#listeners.get(type) ?? []) {
      listener(event)
    }
  }

  connectionOpened() {
    this.#emit('open', { type: 'open' })
  }

  connectionErrored() {
    this.#emit('error', { type: 'error' })
  }

  /** One WS frame, serialized exactly as the backend broadcasts it. */
  deliver(scope: WsMessageScope | 'screencast', data: unknown) {
    this.#emit('message', { data: JSON.stringify({ scope, data }) })
  }

  deliverRaw(payload: string) {
    this.#emit('message', { data: payload })
  }
}

interface Harness {
  host: StubHost
  manager: DataManagerController
  /** The client socket, absent when the trace probe put the app in player mode. */
  socket: FakeSocket | undefined
  deliver: (scope: WsMessageScope | 'screencast', data: unknown) => void
}

const nextTask = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

let traceProbe: () => Promise<unknown>
let fetchedUrls: string[]
let warnings: string[]

/** The trace-probe response shape the controller reads: `ok`, `status`, `json()`
 *  only — typed as the parts used rather than a full `Response` fake. */
function probeResponse(status: number, body?: TracePlayerData) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body)
  }
}

async function boot(
  options: { trace?: TracePlayerData; probeFails?: boolean } = {}
): Promise<Harness> {
  if (options.probeFails) {
    traceProbe = () => Promise.reject(new Error('no trace server'))
  } else if (options.trace) {
    traceProbe = () => Promise.resolve(probeResponse(200, options.trace))
  } else {
    traceProbe = () => Promise.resolve(probeResponse(204))
  }

  const host = document.createElement('data-manager-stub-host') as StubHost
  document.body.append(host)
  const manager = new DataManagerController(host)
  manager.hostConnected()
  await nextTask()

  const socket = FakeSocket.opened[FakeSocket.opened.length - 1]
  socket?.connectionOpened()
  return {
    host,
    manager,
    socket,
    deliver: (scope, data) => socket?.deliver(scope, data)
  }
}

function command(overrides: Partial<CommandLog> = {}): CommandLog {
  return {
    command: 'click',
    args: ['#submit'],
    timestamp: RUN_START,
    ...overrides
  }
}

function request(overrides: Partial<NetworkRequest> = {}): NetworkRequest {
  return {
    id: 'req-1',
    url: LOGIN_URL,
    method: 'GET',
    status: 200,
    timestamp: RUN_START,
    ...overrides
  } as NetworkRequest
}

function test(
  uid: string,
  overrides: Partial<TestStatsFragment> = {}
): TestStatsFragment {
  return {
    uid,
    title: uid,
    fullTitle: `login page ${uid}`,
    file: '/specs/login.e2e.ts',
    state: 'passed',
    ...overrides
  }
}

function suite(
  uid: string,
  overrides: Partial<SuiteStatsFragment> = {}
): SuiteStatsFragment {
  return {
    uid,
    title: uid,
    fullTitle: uid,
    file: '/specs/login.e2e.ts',
    start: new Date(RUN_START),
    tests: [],
    suites: [],
    ...overrides
  } as SuiteStatsFragment
}

/** A `suites` frame as the reporter sends it: chunks keyed by root-suite uid. */
const suitesFrame = (...roots: SuiteStatsFragment[]) =>
  roots.map((root) => ({ [root.uid]: root }))

function attempt(overrides: Partial<PreservedAttempt> = {}): PreservedAttempt {
  return {
    testUid: 'login-test',
    scope: 'test',
    capturedAt: RUN_START + 5000,
    window: { start: RUN_START, end: RUN_START + 4000 },
    test: { title: 'fills the login form', state: 'failed' },
    commands: [command({ command: 'url', args: [LOGIN_URL] })],
    consoleLogs: [],
    networkRequests: [],
    mutations: [],
    sources: {},
    ...overrides
  }
}

function traceLog(overrides: Partial<TraceLog> = {}): TraceLog {
  return {
    mutations: [],
    logs: ['run finished'],
    consoleLogs: [],
    networkRequests: [request()],
    metadata: { sessionId: SESSION, type: TraceType.Testrunner },
    commands: [command()],
    sources: { '/specs/login.e2e.ts': 'await browser.url(url)' },
    suites: suitesFrame(suite('login-suite')),
    ...overrides
  }
}

const playerData = (
  overrides: Partial<TracePlayerData> = {}
): TracePlayerData => ({
  trace: traceLog(),
  frames: [{ timestamp: RUN_START, screenshot: 'iVBORw0KGg' }],
  startTime: RUN_START,
  duration: 4000,
  ...overrides
})

/** Every root suite the app publishes, flattened out of the keyed chunks. */
const publishedSuites = (
  manager: DataManagerController
): SuiteStatsFragment[] =>
  (manager.suitesContextProvider.value || []).flatMap((chunk) =>
    Object.values(chunk)
  )

const publishedUids = (manager: DataManagerController): string[] =>
  (manager.suitesContextProvider.value || []).flatMap((chunk) =>
    Object.keys(chunk)
  )

beforeEach(() => {
  FakeSocket.opened = []
  fetchedUrls = []
  warnings = []
  rerunState.activeRerunSuiteUid = undefined
  rerunState.isTopLevelRerun = false
  localStorage.clear()
  document.body.innerHTML = ''
  traceProbe = () => Promise.resolve(probeResponse(204))
  vi.stubGlobal('WebSocket', FakeSocket)
  vi.stubGlobal('fetch', (url: string) => {
    fetchedUrls.push(String(url))
    return traceProbe()
  })
  vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
    warnings.push(args.map(String).join(' '))
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('DataManagerController', () => {
  describe('bootstrap', () => {
    it('probes the trace endpoint before opening a live socket', async () => {
      await boot()

      expect(fetchedUrls).toEqual([TRACE_API.get])
      expect(FakeSocket.opened).toHaveLength(1)
      expect(FakeSocket.opened[0].url).toContain('/client')
    })

    it('reports a connection once the socket opens', async () => {
      const host = document.createElement('data-manager-stub-host') as StubHost
      const manager = new DataManagerController(host)
      manager.hostConnected()
      await nextTask()

      expect(manager.hasConnection).toBe(false)

      FakeSocket.opened[0].connectionOpened()

      expect(manager.hasConnection).toBe(true)
    })

    it('ignores frames that arrive before the socket opened', async () => {
      const host = document.createElement('data-manager-stub-host') as StubHost
      const manager = new DataManagerController(host)
      manager.hostConnected()
      await nextTask()

      FakeSocket.opened[0].deliver('commands', [command()])

      expect(manager.commandsContextProvider.value).toEqual([])
    })

    it('plays a served trace instead of connecting to a socket', async () => {
      const data = playerData()
      const { manager } = await boot({ trace: data })

      expect(manager.playerMode).toBe(true)
      expect(manager.hasConnection).toBe(true)
      expect(FakeSocket.opened).toHaveLength(0)
      expect(manager.framesContextProvider.value).toEqual(data.frames)
      expect(manager.commandsContextProvider.value).toEqual(data.trace.commands)
    })

    it('stays in live mode when the probe serves no trace', async () => {
      const { manager } = await boot()

      expect(manager.playerMode).toBe(false)
      expect(manager.framesContextProvider.value).toEqual([])
    })

    it('falls back to the socket when the probe request fails', async () => {
      const { manager } = await boot({ probeFails: true })

      expect(manager.playerMode).toBe(false)
      expect(FakeSocket.opened).toHaveLength(1)
      expect(manager.hasConnection).toBe(true)
    })

    it('closes the socket when the host goes away', async () => {
      const { manager, socket } = await boot()

      manager.hostDisconnected()

      expect(socket?.closed).toBe(true)
    })

    it('replays a cached trace when the socket errors', async () => {
      const cached = traceLog({ logs: ['from the cache'] })
      localStorage.setItem(CACHE_ID, JSON.stringify(cached))
      const { manager, socket } = await boot()

      socket?.connectionErrored()

      expect(manager.logsContextProvider.value).toEqual(['from the cache'])
    })

    it('warns rather than throwing when the cache holds no trace', async () => {
      const { socket } = await boot()

      socket?.connectionErrored()

      expect(warnings.join('\n')).toContain('cached trace file')
    })
  })

  describe('accumulating execution data', () => {
    it('appends each commands frame to the ones before it', async () => {
      const { manager, deliver } = await boot()

      deliver('commands', [command({ command: 'url', timestamp: RUN_START })])
      deliver('commands', [
        command({ command: 'click', timestamp: RUN_START + 10 })
      ])

      expect(
        manager.commandsContextProvider.value?.map((entry) => entry.command)
      ).toEqual(['url', 'click'])
    })

    it('appends mutations and console logs the same way', async () => {
      const { manager, deliver } = await boot()

      deliver('mutations', [{ type: 'attributes', timestamp: RUN_START }])
      deliver('mutations', [{ type: 'childList', timestamp: RUN_START + 5 }])
      deliver('consoleLogs', [{ type: 'log', args: ['first'] }])
      deliver('consoleLogs', [{ type: 'error', args: ['second'] }])

      expect(manager.mutationsContextProvider.value).toHaveLength(2)
      expect(manager.consoleLogsContextProvider.value).toHaveLength(2)
    })

    it('replaces the runner log buffer instead of appending it', async () => {
      // The adapter resends the whole terminal buffer each time; appending would
      // duplicate every line already on screen.
      const { manager, deliver } = await boot()

      deliver('logs', ['spec started'])
      deliver('logs', ['spec started', 'spec finished'])

      expect(manager.logsContextProvider.value).toEqual([
        'spec started',
        'spec finished'
      ])
    })

    it('asks the host to re-render for every frame it accepts', async () => {
      const { host, deliver } = await boot()
      const before = host.updateRequests

      deliver('commands', [command()])

      expect(host.updateRequests).toBeGreaterThan(before)
    })

    it('swaps a command in place when the adapter reissues it', async () => {
      const { manager, deliver } = await boot()
      deliver('commands', [
        command({ command: 'getText', timestamp: RUN_START }),
        command({ command: 'click', timestamp: RUN_START + 50 })
      ])

      deliver(WS_SCOPE.replaceCommand, {
        oldTimestamp: RUN_START,
        command: command({ command: 'expect.toHaveText', timestamp: RUN_START })
      })

      expect(
        manager.commandsContextProvider.value?.map((entry) => entry.command)
      ).toEqual(['expect.toHaveText', 'click'])
    })

    it('dedups network requests by their request id', async () => {
      const { manager, deliver } = await boot()

      deliver('networkRequests', [request({ id: 'req-1', status: 0 })])
      deliver('networkRequests', [request({ id: 'req-1', status: 302 })])

      expect(manager.networkRequestsContextProvider.value).toHaveLength(1)
      expect(manager.networkRequestsContextProvider.value?.[0].status).toBe(302)
    })

    it('keeps every request that carries no id', async () => {
      const { manager, deliver } = await boot()

      deliver('networkRequests', [request({ id: undefined })])
      deliver('networkRequests', [request({ id: undefined })])

      expect(manager.networkRequestsContextProvider.value).toHaveLength(2)
    })

    it('merges source files across frames', async () => {
      const { manager, deliver } = await boot()

      deliver('sources', { '/specs/login.e2e.ts': 'first' })
      deliver('sources', {
        '/specs/login.e2e.ts': 'second',
        '/specs/checkout.e2e.ts': 'other'
      })

      expect(manager.sourcesContextProvider.value).toEqual({
        '/specs/login.e2e.ts': 'second',
        '/specs/checkout.e2e.ts': 'other'
      })
    })
  })

  describe('metadata', () => {
    it('publishes the running session as the active metadata', async () => {
      const { manager, deliver } = await boot()

      deliver('metadata', { sessionId: SESSION, testEnv: 'chrome' })

      expect(manager.metadataContextProvider.value?.testEnv).toBe('chrome')
      expect(
        Object.keys(manager.metadataBySessionContextProvider.value ?? {})
      ).toEqual([SESSION])
    })

    it('attributes a session-less update to the session in flight', async () => {
      const { manager, deliver } = await boot()

      deliver('metadata', { sessionId: SESSION, testEnv: 'chrome' })
      deliver('metadata', { url: LOGIN_URL })

      const bySession = manager.metadataBySessionContextProvider.value ?? {}
      expect(Object.keys(bySession)).toEqual([SESSION])
      expect(manager.metadataContextProvider.value?.url).toBe(LOGIN_URL)
      expect(manager.metadataContextProvider.value?.testEnv).toBe('chrome')
    })

    it('exposes the capture type of the active session', async () => {
      const { manager, deliver } = await boot()

      expect(manager.traceType).toBe(undefined)

      deliver('metadata', { sessionId: SESSION, type: 'trace' })

      expect(manager.traceType).toBe('trace')
    })
  })

  describe('the suite tree', () => {
    it('publishes one entry per root suite, keyed by uid', async () => {
      const { manager, deliver } = await boot()

      deliver(
        'suites',
        suitesFrame(suite('login-suite'), suite('checkout-suite'))
      )

      expect(publishedUids(manager)).toEqual(['login-suite', 'checkout-suite'])
    })

    it('folds repeated frames for one suite into a single entry', async () => {
      const { manager, deliver } = await boot()

      deliver(
        'suites',
        suitesFrame(suite('login-suite', { tests: [test('t-1')] }))
      )
      deliver(
        'suites',
        suitesFrame(
          suite('login-suite', {
            tests: [test('t-1'), test('t-2')],
            end: new Date(RUN_START + 4000)
          })
        )
      )

      expect(publishedUids(manager)).toEqual(['login-suite'])
      expect(
        publishedSuites(manager)[0].tests?.map((entry) => entry.uid)
      ).toEqual(['t-1', 't-2'])
    })

    it('dedups a test that is resent inside its suite', async () => {
      const { manager, deliver } = await boot()

      deliver(
        'suites',
        suitesFrame(
          suite('login-suite', { tests: [test('t-1', { state: 'running' })] })
        )
      )
      deliver(
        'suites',
        suitesFrame(
          suite('login-suite', { tests: [test('t-1', { state: 'failed' })] })
        )
      )

      const tests = publishedSuites(manager)[0].tests ?? []
      expect(tests).toHaveLength(1)
      expect(tests[0].state).toBe('failed')
    })

    it('accepts a suites frame sent as a single object', async () => {
      const { manager, deliver } = await boot()

      deliver('suites', { 'login-suite': suite('login-suite') })

      expect(publishedUids(manager)).toEqual(['login-suite'])
    })

    it('drops entries that carry no uid', async () => {
      const { manager, deliver } = await boot()

      deliver('suites', [{ ghost: { title: 'no uid' } }])

      expect(publishedSuites(manager)).toEqual([])
    })

    it('wipes execution data when a finished suite starts a new run', async () => {
      const { manager, deliver } = await boot()
      deliver(
        'suites',
        suitesFrame(suite('login-suite', { end: new Date(RUN_START + 10) }))
      )
      deliver('commands', [command()])

      deliver(
        'suites',
        suitesFrame(
          suite('login-suite', { start: new Date(RUN_START + 60_000) })
        )
      )

      expect(manager.commandsContextProvider.value).toEqual([])
      // The tree itself survives so the sidebar keeps its rows.
      expect(publishedUids(manager)).toEqual(['login-suite'])
    })

    it('keeps execution data while the same run continues', async () => {
      const { manager, deliver } = await boot()
      deliver('suites', suitesFrame(suite('login-suite')))
      deliver('commands', [command()])

      deliver(
        'suites',
        suitesFrame(
          suite('login-suite', { start: new Date(RUN_START + 60_000) })
        )
      )

      expect(manager.commandsContextProvider.value).toHaveLength(1)
    })
  })

  describe('baselines', () => {
    it('publishes a preserved attempt under its test uid', async () => {
      const { manager, deliver } = await boot()
      const preserved = attempt()

      deliver(BASELINE_WS_SCOPE.saved, {
        testUid: 'login-test',
        attempt: preserved
      })

      expect(manager.baselineContextProvider.value?.get('login-test')).toEqual(
        preserved
      )
    })

    it('selects the preserved test so the comparison has a pair', async () => {
      const { manager, deliver } = await boot()

      deliver(BASELINE_WS_SCOPE.saved, {
        testUid: 'login-test',
        attempt: attempt()
      })

      expect(manager.selectedTestUidContextProvider.value).toBe('login-test')
    })

    it('keeps earlier baselines when another test is preserved', async () => {
      const { manager, deliver } = await boot()

      deliver(BASELINE_WS_SCOPE.saved, {
        testUid: 'login-test',
        attempt: attempt()
      })
      deliver(BASELINE_WS_SCOPE.saved, {
        testUid: 'checkout-test',
        attempt: attempt({ testUid: 'checkout-test' })
      })

      expect([
        ...(manager.baselineContextProvider.value?.keys() ?? [])
      ]).toEqual(['login-test', 'checkout-test'])
    })

    it('publishes a fresh map rather than mutating the one consumers hold', async () => {
      // A context value that changes identity is what makes `subscribe: true`
      // consumers (the workbench's Compare tab) re-render.
      const { manager, deliver } = await boot()
      const before = manager.baselineContextProvider.value

      deliver(BASELINE_WS_SCOPE.saved, {
        testUid: 'login-test',
        attempt: attempt()
      })

      expect(manager.baselineContextProvider.value).not.toBe(before)
      expect(before?.size).toBe(0)
    })

    it('drops only the cleared test from the map', async () => {
      const { manager, deliver } = await boot()
      deliver(BASELINE_WS_SCOPE.saved, {
        testUid: 'login-test',
        attempt: attempt()
      })
      deliver(BASELINE_WS_SCOPE.saved, {
        testUid: 'checkout-test',
        attempt: attempt({ testUid: 'checkout-test' })
      })

      deliver(BASELINE_WS_SCOPE.cleared, { testUid: 'login-test' })

      expect([
        ...(manager.baselineContextProvider.value?.keys() ?? [])
      ]).toEqual(['checkout-test'])
    })

    it('leaves the map alone when an unknown test is cleared', async () => {
      const { manager, deliver } = await boot()
      deliver(BASELINE_WS_SCOPE.saved, {
        testUid: 'login-test',
        attempt: attempt()
      })

      deliver(BASELINE_WS_SCOPE.cleared, { testUid: 'never-preserved' })

      expect([
        ...(manager.baselineContextProvider.value?.keys() ?? [])
      ]).toEqual(['login-test'])
    })

    it('publishes a fresh map on a clear too', async () => {
      const { manager, deliver } = await boot()
      deliver(BASELINE_WS_SCOPE.saved, {
        testUid: 'login-test',
        attempt: attempt()
      })
      const before = manager.baselineContextProvider.value

      deliver(BASELINE_WS_SCOPE.cleared, { testUid: 'login-test' })

      expect(manager.baselineContextProvider.value).not.toBe(before)
      expect(manager.baselineContextProvider.value?.size).toBe(0)
    })

    it('keeps the selection when the baseline is cleared', async () => {
      // The panel reads both; clearing the baseline is not a deselection.
      const { manager, deliver } = await boot()
      deliver(BASELINE_WS_SCOPE.saved, {
        testUid: 'login-test',
        attempt: attempt()
      })

      deliver(BASELINE_WS_SCOPE.cleared, { testUid: 'login-test' })

      expect(manager.selectedTestUidContextProvider.value).toBe('login-test')
    })

    it('publishes the test the sidebar selects', async () => {
      const { manager } = await boot()

      manager.setSelectedTestUid('checkout-test')

      expect(manager.selectedTestUidContextProvider.value).toBe('checkout-test')
    })
  })

  describe('rerun and stop control', () => {
    it('wipes execution data but keeps the suite tree on a rerun clear', async () => {
      const { manager, deliver } = await boot()
      deliver(
        'suites',
        suitesFrame(suite('login-suite', { tests: [test('t-1')] }))
      )
      deliver('commands', [command()])
      deliver('consoleLogs', [{ type: 'log', args: ['noise'] }])
      deliver('networkRequests', [request()])

      deliver(WS_SCOPE.clearExecutionData, { uid: 't-1', entryType: 'test' })

      expect(manager.commandsContextProvider.value).toEqual([])
      expect(manager.consoleLogsContextProvider.value).toEqual([])
      expect(manager.networkRequestsContextProvider.value).toEqual([])
      expect(publishedUids(manager)).toEqual(['login-suite'])
    })

    it('marks the rerun test as pending so its row spins', async () => {
      const { manager, deliver } = await boot()
      deliver(
        'suites',
        suitesFrame(suite('login-suite', { tests: [test('t-1')] }))
      )

      deliver(WS_SCOPE.clearExecutionData, { uid: 't-1', entryType: 'test' })

      const [first] = publishedSuites(manager)
      expect(first.tests?.[0].state).toBe('pending')
      expect(first.state).toBe('running')
    })

    it('marks the whole tree running for a rerun with no uid', async () => {
      const { manager, deliver } = await boot()
      deliver(
        'suites',
        suitesFrame(
          suite('login-suite', { state: 'passed', tests: [test('t-1')] }),
          suite('checkout-suite', { state: 'failed' })
        )
      )

      deliver(WS_SCOPE.clearExecutionData, {})

      expect(publishedSuites(manager).map((entry) => entry.state)).toEqual([
        'running',
        'running'
      ])
    })

    it('empties the tree when the backend asks for it', async () => {
      const { manager, deliver } = await boot()
      deliver('suites', suitesFrame(suite('login-suite')))

      deliver(WS_SCOPE.clearExecutionData, { clearSuiteTree: true })

      expect(manager.suitesContextProvider.value).toEqual([])
    })

    it('fails the tests still in flight when the run is stopped', async () => {
      const { manager, deliver } = await boot()
      deliver(
        'suites',
        suitesFrame(
          suite('login-suite', {
            state: 'running',
            tests: [test('t-1', { state: 'running', end: undefined })]
          })
        )
      )

      deliver(WS_SCOPE.testStopped, { stopped: true })

      const [first] = publishedSuites(manager)
      expect(first.tests?.[0].state).toBe('failed')
      expect(first.tests?.[0].end).toBeDefined()
      expect(first.state).toBe('failed')
    })
  })

  describe('screencast handoff', () => {
    it('re-announces a ready screencast to the player as a window event', async () => {
      const { deliver } = await boot()
      const seen: unknown[] = []
      const listener = (event: Event) =>
        seen.push((event as CustomEvent).detail)
      window.addEventListener('screencast-ready', listener)

      deliver('screencast', {
        sessionId: SESSION,
        startTime: RUN_START,
        duration: 4000
      })
      window.removeEventListener('screencast-ready', listener)

      expect(seen).toEqual([
        { sessionId: SESSION, startTime: RUN_START, duration: 4000 }
      ])
    })
  })

  describe('malformed traffic', () => {
    it('warns and keeps its state when a frame is not JSON', async () => {
      const { manager, socket, deliver } = await boot()
      deliver('commands', [command()])

      socket?.deliverRaw('<html>gateway error</html>')

      expect(manager.commandsContextProvider.value).toHaveLength(1)
      expect(warnings.join('\n')).toContain('socket message')
    })

    it('ignores a frame with no payload', async () => {
      const { manager, deliver } = await boot()

      deliver('commands', null)

      expect(manager.commandsContextProvider.value).toEqual([])
      expect(warnings).toEqual([])
    })

    it('ignores a scope it does not handle', async () => {
      const { host, manager, deliver } = await boot()

      deliver('config' as WsMessageScope, { configFile: 'wdio.conf.ts' })

      expect(manager.commandsContextProvider.value).toEqual([])
      expect(host.updateRequests).toBeGreaterThan(0)
    })
  })

  describe('loading a trace file', () => {
    it('publishes every panel’s data out of the trace', async () => {
      const { manager } = await boot()
      const trace = traceLog()

      manager.loadTraceFile(trace)

      expect(manager.commandsContextProvider.value).toEqual(trace.commands)
      expect(manager.logsContextProvider.value).toEqual(trace.logs)
      expect(manager.networkRequestsContextProvider.value).toEqual(
        trace.networkRequests
      )
      expect(manager.sourcesContextProvider.value).toEqual(trace.sources)
      expect(publishedUids(manager)).toEqual(['login-suite'])
    })

    it('caches the trace so a socket failure can replay it', async () => {
      const { manager } = await boot()

      manager.loadTraceFile(traceLog())

      expect(
        JSON.parse(localStorage.getItem(CACHE_ID) ?? 'null')
      ).toMatchObject({
        logs: ['run finished']
      })
    })

    it('still publishes a trace too large to cache', async () => {
      const { manager } = await boot()
      // A real quota rejection: the store is the only thing that can refuse.
      const setItem = vi
        .spyOn(window.localStorage, 'setItem')
        .mockImplementation(() => {
          throw new Error('QuotaExceededError')
        })

      manager.loadTraceFile(traceLog())
      setItem.mockRestore()

      expect(manager.commandsContextProvider.value).toHaveLength(1)
      expect(warnings.join('\n')).toContain('Trace too large')
    })

    it('keys the trace’s metadata by its session', async () => {
      const { manager } = await boot()

      manager.loadTraceFile(traceLog())

      expect(
        Object.keys(manager.metadataBySessionContextProvider.value ?? {})
      ).toEqual([SESSION])
    })

    it('publishes no session map for a trace without a session id', async () => {
      const { manager } = await boot()

      manager.loadTraceFile(
        traceLog({ metadata: { type: TraceType.Testrunner } })
      )

      expect(manager.metadataBySessionContextProvider.value).toEqual({})
    })

    it('attributes a later session-less metadata frame to the trace’s session', async () => {
      const { manager, deliver } = await boot()
      manager.loadTraceFile(traceLog())

      deliver('metadata', { url: LOGIN_URL })

      expect(
        Object.keys(manager.metadataBySessionContextProvider.value ?? {})
      ).toEqual([SESSION])
    })
  })
})
