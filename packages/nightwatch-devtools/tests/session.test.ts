import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SessionCapturer } from '../src/session.js'
import type { CommandLog, NightwatchBrowser } from '../src/types.js'

type CommandLogWithId = CommandLog & { _id: number }

function makeMockBrowser(
  overrides: Partial<Record<string, unknown>> = {}
): NightwatchBrowser {
  return {
    url: vi.fn(async () => ({})),
    execute: vi.fn(async () => ({ value: null })),
    executeAsync: vi.fn(async () => ({ value: null })),
    pause: vi.fn(async () => ({})),
    ...overrides
  } as unknown as NightwatchBrowser
}

function makeCapturer(browser?: NightwatchBrowser): SessionCapturer {
  // No hostname/port → no WebSocket; lets us unit-test the capture surface
  // without a backend stub.
  return new SessionCapturer({}, browser)
}

describe('SessionCapturer.captureCommand', () => {
  it('pushes the entry into commandsLog with a stable _id', async () => {
    const cap = makeCapturer()
    await cap.captureCommand('click', ['#btn'], { ok: true }, undefined)
    await cap.captureCommand('url', ['https://x'], undefined, undefined)
    expect(cap.commandsLog).toHaveLength(2)
    expect(cap.commandsLog[0]).toMatchObject({
      command: 'click',
      args: ['#btn'],
      result: { ok: true }
    })
    expect((cap.commandsLog[0] as CommandLogWithId)._id).not.toBe(
      (cap.commandsLog[1] as CommandLogWithId)._id
    )
  })

  it('carries the row metadata off the meta bag', async () => {
    const cap = makeCapturer()
    await cap.captureCommand('getText', ['#flash'], undefined, undefined, {
      timestamp: 12345,
      startTime: 12300,
      sequence: 7,
      callSource: '/tests/spec.js:5',
      selector: '#flash'
    })
    expect(cap.commandsLog[0]).toMatchObject({
      timestamp: 12345,
      startTime: 12300,
      sequence: 7,
      callSource: '/tests/spec.js:5',
      selector: '#flash'
    })
  })

  it('serializes Error before storing', async () => {
    const cap = makeCapturer()
    const err = new Error('boom')
    await cap.captureCommand('click', [], undefined, err)
    const stored = cap.commandsLog[0].error as { name: string; message: string }
    expect(stored.name).toBe('Error')
    expect(stored.message).toBe('boom')
  })

  it('triggers performance capture for navigation commands when browser present', async () => {
    const execute = vi.fn(async () => ({ value: undefined }))
    const browser = makeMockBrowser({ execute })
    const cap = makeCapturer(browser)
    await cap.captureCommand('url', ['https://x'], undefined, undefined)
    // perf capture runs in background after a 500ms delay; let it settle
    await new Promise((r) => setTimeout(r, 600))
    expect(execute).toHaveBeenCalled()
  })

  it('skips performance capture when error present', async () => {
    const execute = vi.fn()
    const browser = makeMockBrowser({ execute })
    const cap = makeCapturer(browser)
    await cap.captureCommand('url', ['https://x'], undefined, new Error('nav'))
    await new Promise((r) => setTimeout(r, 50))
    expect(execute).not.toHaveBeenCalled()
  })

  it('stores testUid on the captured entry', async () => {
    const cap = makeCapturer()
    await cap.captureCommand('click', ['.btn'], undefined, undefined, {
      testUid: 'uid-nightwatch-1'
    })
    expect(cap.commandsLog[0].testUid).toBe('uid-nightwatch-1')
  })

  it('leaves testUid undefined when not provided', async () => {
    const cap = makeCapturer()
    await cap.captureCommand('click', ['.btn'], undefined, undefined)
    expect(cap.commandsLog[0].testUid).toBeUndefined()
  })
})

describe('SessionCapturer.replaceCommand', () => {
  it('splices the old entry and reissues with a new _id', async () => {
    const cap = makeCapturer()
    await cap.captureCommand('click', ['#a'], undefined, undefined)
    const oldId = (cap.commandsLog[0] as CommandLogWithId)._id
    const oldTs = cap.commandsLog[0].timestamp
    const { entry, oldTimestamp } = cap.replaceCommand(
      oldId,
      'click',
      ['#a'],
      { ok: true },
      undefined
    )
    expect(oldTimestamp).toBe(oldTs)
    expect(cap.commandsLog).toHaveLength(1)
    expect((cap.commandsLog[0] as CommandLogWithId)._id).not.toBe(oldId)
    expect(entry.result).toEqual({ ok: true })
  })

  it('returns oldTimestamp=0 when oldId not found', async () => {
    const cap = makeCapturer()
    const { oldTimestamp } = cap.replaceCommand(
      999,
      'click',
      [],
      undefined,
      undefined
    )
    expect(oldTimestamp).toBe(0)
  })
})

describe('SessionCapturer.captureBrowserLogs', () => {
  it('maps Chrome browser log entries into consoleLogs and broadcasts', async () => {
    const browser = makeMockBrowser({
      getLog: vi.fn(async () => [
        { level: 'INFO', message: 'console-api hello', timestamp: 1000 }
      ])
    })
    const cap = makeCapturer(browser)
    const send = vi.spyOn(
      cap as unknown as { sendUpstream: (e: string, d: unknown) => void },
      'sendUpstream'
    )
    await cap.captureBrowserLogs(browser)
    expect(cap.consoleLogs).toHaveLength(1)
    expect(send).toHaveBeenCalledWith('consoleLogs', expect.any(Array))
  })

  it('silently no-ops when getLog throws (perf logging not enabled)', async () => {
    const browser = makeMockBrowser({
      getLog: vi.fn(async () => {
        throw new Error('unknown log type')
      })
    })
    const cap = makeCapturer(browser)
    await expect(cap.captureBrowserLogs(browser)).resolves.toBeUndefined()
    expect(cap.consoleLogs).toHaveLength(0)
  })

  it('no-ops when getLog returns an empty array', async () => {
    const browser = makeMockBrowser({
      getLog: vi.fn(async () => [])
    })
    const cap = makeCapturer(browser)
    await cap.captureBrowserLogs(browser)
    expect(cap.consoleLogs).toHaveLength(0)
  })
})

describe('SessionCapturer.captureNetworkFromPerformanceLogs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('short-circuits when BiDi is active (no double-emit)', async () => {
    const getLog = vi.fn()
    const browser = makeMockBrowser({ getLog })
    const cap = makeCapturer(browser)
    cap.bidiActive = true
    await cap.captureNetworkFromPerformanceLogs(browser)
    expect(getLog).not.toHaveBeenCalled()
  })

  it('parses CDP performance logs into networkRequests', async () => {
    const perfMessage = {
      message: JSON.stringify({
        message: {
          method: 'Network.requestWillBeSent',
          params: {
            requestId: 'r1',
            request: { url: 'https://x/api', method: 'GET', headers: {} },
            timestamp: 1
          }
        }
      }),
      timestamp: 1700000000000
    }
    const finishMessage = {
      message: JSON.stringify({
        message: {
          method: 'Network.responseReceived',
          params: {
            requestId: 'r1',
            response: {
              status: 200,
              statusText: 'OK',
              headers: { 'content-type': 'application/json' },
              mimeType: 'application/json'
            }
          }
        }
      }),
      timestamp: 1700000000100
    }
    const loadingFinished = {
      message: JSON.stringify({
        message: {
          method: 'Network.loadingFinished',
          params: { requestId: 'r1', encodedDataLength: 42 }
        }
      }),
      timestamp: 1700000000200
    }
    const browser = makeMockBrowser({
      getLog: vi.fn(async () => [perfMessage, finishMessage, loadingFinished])
    })
    const cap = makeCapturer(browser)
    cap.perfLogsRequested = true
    await cap.captureNetworkFromPerformanceLogs(browser)
    expect(cap.networkRequests).toHaveLength(1)
    expect(cap.networkRequests[0]).toMatchObject({
      url: 'https://x/api',
      method: 'GET',
      status: 200
    })
  })

  it('swallows expected "log type not enabled" errors silently', async () => {
    const browser = makeMockBrowser({
      getLog: vi.fn(async () => {
        throw new Error('unknown log type: performance')
      })
    })
    const cap = makeCapturer(browser)
    cap.perfLogsRequested = true
    await expect(
      cap.captureNetworkFromPerformanceLogs(browser)
    ).resolves.toBeUndefined()
  })

  // A perf log exists only because the session asked for one, so without the
  // capability the fetch can only fail — once per command, each failure printed
  // by the driver's own transport. Measured on iOS Safari: 21 error blocks in a
  // two-test run that passed.
  it('does not fetch when the session asked for no perf log', async () => {
    const getLog = vi.fn()
    const browser = makeMockBrowser({ getLog })
    const cap = makeCapturer(browser)
    await cap.captureNetworkFromPerformanceLogs(browser)
    expect(getLog).not.toHaveBeenCalled()
  })
})

describe('SessionCapturer.takeScreenshotViaHttp', () => {
  it('returns null when no sessionId on the browser', async () => {
    const browser = makeMockBrowser()
    const cap = makeCapturer(browser)
    expect(await cap.takeScreenshotViaHttp(browser)).toBeNull()
  })

  it('parses { value } JSON from the driver screenshot endpoint', async () => {
    const http = await import('node:http')
    const server = http.createServer((_req, res) => {
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ value: 'base64data' }))
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
    const port = (server.address() as { port: number }).port
    const browser = makeMockBrowser({
      sessionId: 'sess-1',
      transport: {
        settings: { webdriver: { host: '127.0.0.1', port } }
      }
    })
    const cap = makeCapturer(browser)
    try {
      expect(await cap.takeScreenshotViaHttp(browser)).toBe('base64data')
    } finally {
      await new Promise<void>((r) => server.close(() => r()))
    }
  })

  it('returns null when the response body is not JSON', async () => {
    const http = await import('node:http')
    const server = http.createServer((_req, res) => {
      res.end('<<not json>>')
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
    const port = (server.address() as { port: number }).port
    const browser = makeMockBrowser({
      sessionId: 'sess-2',
      transport: {
        settings: { webdriver: { host: '127.0.0.1', port } }
      }
    })
    const cap = makeCapturer(browser)
    try {
      expect(await cap.takeScreenshotViaHttp(browser)).toBeNull()
    } finally {
      await new Promise<void>((r) => server.close(() => r()))
    }
  })

  it('returns null when the request fails (no listener)', async () => {
    // Connect to a port nothing is listening on
    const browser = makeMockBrowser({
      sessionId: 'sess-3',
      transport: {
        settings: { webdriver: { host: '127.0.0.1', port: 1 } }
      }
    })
    const cap = makeCapturer(browser)
    expect(await cap.takeScreenshotViaHttp(browser)).toBeNull()
  })
})

describe('SessionCapturer.captureTrace', () => {
  it('delegates to captureNetworkFromPerformanceLogs and stops when no collector', async () => {
    const browser = makeMockBrowser({
      // captureNetworkFromPerformanceLogs call (getLog) — return empty
      getLog: vi.fn(async () => []),
      // execute is called: first to check window.wdioTraceCollector, returns false-equivalent
      execute: vi.fn(async () => ({ value: false }))
    })
    const cap = makeCapturer(browser)
    await cap.captureTrace(browser)
    // No mutations / commands added since collector not present
    expect(cap.networkRequests).toHaveLength(0)
  })

  it('processes trace payload when collector is present', async () => {
    // The drain goes over the raw WebDriver HTTP transport, never through
    // `browser.execute` — that is a QUEUED command, and deferring the drain off
    // Nightwatch's callback stack to use it lost the outgoing page's field edits
    // whenever the next command navigated.
    const http = await import('node:http')
    const bodies: string[] = []
    const server = http.createServer((req, res) => {
      let raw = ''
      req.on('data', (c) => {
        raw += c
      })
      req.on('end', () => {
        bodies.push(raw)
        res.setHeader('content-type', 'application/json')
        res.end(
          JSON.stringify({
            value: {
              mutations: [
                { type: 'attributes', addedNodes: [], removedNodes: [] }
              ],
              networkRequests: [],
              consoleLogs: []
            }
          })
        )
      })
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
    const port = (server.address() as { port: number }).port
    const browser = makeMockBrowser({
      getLog: vi.fn(async () => []),
      sessionId: 'sess-drain',
      transport: { settings: { webdriver: { host: '127.0.0.1', port } } }
    })
    const cap = makeCapturer(browser)
    try {
      await cap.captureTrace(browser)
      expect(bodies).toHaveLength(1)
      expect(bodies[0]).toContain('getTraceData')
      expect(cap.mutations).toHaveLength(1)
      expect(browser.execute).not.toHaveBeenCalled()
    } finally {
      await new Promise<void>((r) => server.close(() => r()))
    }
  })

  // The collector's buffer dies with the document, so on a navigating command
  // the drain has to reach the driver first; performance logs only accumulate,
  // so they lose nothing by waiting.
  it('drains the collector before it reads the performance logs', async () => {
    const http = await import('node:http')
    const order: string[] = []
    const server = http.createServer((_req, res) => {
      order.push('drain')
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ value: null }))
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
    const port = (server.address() as { port: number }).port
    const browser = makeMockBrowser({
      getLog: vi.fn(async () => {
        order.push('perf-logs')
        return []
      }),
      sessionId: 'sess-order',
      transport: { settings: { webdriver: { host: '127.0.0.1', port } } }
    })
    const cap = makeCapturer(browser)
    cap.perfLogsRequested = true
    try {
      await cap.captureTrace(browser)
      // A `null` payload also sends the drain through its recovery probes, so
      // assert on the boundary: every driver request comes first, and the
      // performance logs run last — and still run at all, which the early
      // return inside the drain would otherwise skip.
      expect(order[0]).toBe('drain')
      expect(order[order.length - 1]).toBe('perf-logs')
      expect(order.filter((step) => step === 'perf-logs')).toHaveLength(1)
    } finally {
      await new Promise<void>((r) => server.close(() => r()))
    }
  })
})

/** One request as Chrome's performance log reports it, with its wall clock. */
const perfLog = (url: string, wallTime: number) =>
  [
    [
      'Network.requestWillBeSent',
      {
        requestId: 'R1',
        request: { url, method: 'GET', headers: { accept: '*/*' } },
        timestamp: 2.0,
        wallTime
      }
    ],
    [
      'Network.responseReceived',
      {
        requestId: 'R1',
        response: {
          status: 200,
          statusText: 'OK',
          headers: { 'content-type': 'text/javascript' },
          mimeType: 'text/javascript'
        },
        timestamp: 2.1
      }
    ],
    ['Network.loadingFinished', { requestId: 'R1', timestamp: 2.15 }]
  ].map(([method, params]) => ({
    level: 'INFO',
    timestamp: 1000,
    message: JSON.stringify({ message: { method, params } })
  }))

/**
 * BiDi counts as the network source only once it has delivered an event:
 * against Appium 3.7's XCUITest driver the inspectors attach and then send
 * nothing, and gating on the attach alone withheld the page's only rows.
 */
describe('SessionCapturer.captureTrace and BiDi evidence', () => {
  const resourceTimingRow = {
    id: 'rt-1',
    url: 'https://x/app.js',
    method: 'GET',
    type: 'script',
    timestamp: 2,
    startTime: 1,
    source: 'resource-timing'
  }

  /** A driver whose drains answer `batches` in turn, the last one repeated;
   *  `null` is a document with no collector, and the url read that recovery
   *  then makes finds no document either. */
  async function drainingServer(
    batches: (unknown[] | null)[] = [[resourceTimingRow]],
    getLog = vi.fn(async () => [])
  ) {
    const http = await import('node:http')
    let drains = 0
    const server = http.createServer((req, res) => {
      let raw = ''
      req.on('data', (c) => {
        raw += c
      })
      req.on('end', () => {
        const batch = raw.includes('location.href')
          ? null
          : batches[Math.min(drains++, batches.length - 1)]
        res.setHeader('content-type', 'application/json')
        res.end(
          JSON.stringify({
            value: batch && { mutations: [], networkRequests: batch }
          })
        )
      })
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
    const port = (server.address() as { port: number }).port
    const browser = makeMockBrowser({
      getLog,
      sessionId: 'sess-bidi',
      transport: { settings: { webdriver: { host: '127.0.0.1', port } } }
    })
    return {
      browser,
      close: () => new Promise<void>((r) => server.close(() => r()))
    }
  }

  it('keeps the page’s rows while an attached BiDi has delivered nothing', async () => {
    const { browser, close } = await drainingServer()
    const cap = makeCapturer(browser)
    cap.bidiActive = true
    try {
      await cap.captureTrace(browser)
      expect(cap.networkRequests.map((r) => r.id)).toEqual(['rt-1'])
    } finally {
      await close()
    }
  })

  /** The page's row for the load the log lists, and a second request to the
   *  same url inside the window. */
  const pageRow = { ...resourceTimingRow, timestamp: 1_760_000_000_500 }
  const laterSameUrl = {
    ...resourceTimingRow,
    id: 'rt-2',
    timestamp: 1_760_000_001_000
  }
  /** A log that lists the load once, at its first read. */
  const logListingOnce = () =>
    vi
      .fn()
      .mockResolvedValueOnce(perfLog('https://x/app.js', 1760000000.52))
      .mockResolvedValue([])

  it('drops the page’s row for a load the log listed first, and only that row', async () => {
    // The log is read after the drain, so a load completing between the two
    // reaches the session as the log's row first and the page's a drain
    // later. A second request to the same url inside the window is a request
    // of its own: it keeps its row rather than being read as the first's
    // second listing, which a scan of every row the session held did.
    const { browser, close } = await drainingServer(
      [[], [pageRow], [laterSameUrl]],
      logListingOnce()
    )
    const cap = makeCapturer(browser)
    cap.perfLogsRequested = true
    try {
      await cap.captureTrace(browser)
      expect(cap.networkRequests.map((r) => r.id)).toEqual(['1000-R1'])
      await cap.captureTrace(browser)
      expect(cap.networkRequests.map((r) => r.id)).toEqual(['1000-R1'])
      await cap.captureTrace(browser)
      expect(cap.networkRequests.map((r) => r.id)).toEqual(['1000-R1', 'rt-2'])
    } finally {
      await close()
    }
  })

  it('spends what the log listed on a drain that found no collector', async () => {
    // The drain reached the driver and the document the load belonged to is
    // gone, so its row is never coming; kept, the load would take the next
    // document's row for the same url.
    const { browser, close } = await drainingServer(
      [[], null, [laterSameUrl]],
      logListingOnce()
    )
    const cap = makeCapturer(browser)
    cap.perfLogsRequested = true
    try {
      await cap.captureTrace(browser)
      await cap.captureTrace(browser)
      await cap.captureTrace(browser)
      expect(cap.networkRequests.map((r) => r.id)).toEqual(['1000-R1', 'rt-2'])
    } finally {
      await close()
    }
  })

  it('drops them once the BiDi sink has received a request', async () => {
    const { buildBidiSinks } = await import('../src/bidi.js')
    const { browser, close } = await drainingServer()
    const cap = makeCapturer(browser)
    cap.bidiActive = true
    buildBidiSinks(cap).pushNetworkRequest({
      id: 'bidi-1',
      url: 'https://x/',
      method: 'GET',
      type: 'document',
      timestamp: 1,
      startTime: 0
    })
    try {
      await cap.captureTrace(browser)
      expect(cap.networkRequests.map((r) => r.id)).toEqual(['bidi-1'])
    } finally {
      await close()
    }
  })
})

describe('SessionCapturer.captureNetworkFromPerformanceLogs upgrades', () => {
  it('upgrades the page’s Resource Timing row in place with what the log saw', async () => {
    // The drain runs before the log is read, so the page's row for a load is
    // already in the session; the log's headers and status replace it under
    // the same id rather than listing the load twice.
    const browser = makeMockBrowser({
      getLog: vi.fn(async () => perfLog('https://x/app.js', 1760000000.52))
    })
    const cap = makeCapturer(browser)
    cap.perfLogsRequested = true
    cap.networkRequests.push({
      id: 'rt-1',
      url: 'https://x/app.js',
      method: 'GET',
      type: 'script',
      timestamp: 1_760_000_000_500,
      startTime: 500,
      source: 'resource-timing'
    })
    const upstream = vi.spyOn(cap, 'sendUpstream')

    await cap.captureNetworkFromPerformanceLogs(browser)

    expect(cap.networkRequests).toHaveLength(1)
    expect(cap.networkRequests[0]).toMatchObject({
      id: 'rt-1',
      status: 200,
      responseHeaders: { 'content-type': 'text/javascript' }
    })
    expect(cap.networkRequests[0].source).toBeUndefined()
    expect(upstream).toHaveBeenCalledWith('networkRequests', [
      expect.objectContaining({ id: 'rt-1', status: 200 })
    ])
  })

  it('still appends a load the page never reported', async () => {
    const browser = makeMockBrowser({
      getLog: vi.fn(async () => perfLog('https://x/other.js', 1760000000.52))
    })
    const cap = makeCapturer(browser)
    cap.perfLogsRequested = true

    await cap.captureNetworkFromPerformanceLogs(browser)

    expect(cap.networkRequests.map((r) => r.url)).toEqual([
      'https://x/other.js'
    ])
  })
})

describe('SessionCapturer.anchorAfterNavigation', () => {
  /** A driver whose `performance.timeOrigin` reads follow `origins`, and whose
   *  drain answers an anchored payload. Every request is one JSON response, so
   *  the sequence of reads is what drives the poll. */
  async function driverServing(origins: number[]) {
    const http = await import('node:http')
    const seen: string[] = []
    let read = 0
    const server = http.createServer((req, res) => {
      let raw = ''
      req.on('data', (c) => {
        raw += c
      })
      req.on('end', () => {
        const isOriginRead = raw.includes('timeOrigin')
        seen.push(isOriginRead ? 'origin' : 'drain')
        res.setHeader('content-type', 'application/json')
        res.end(
          JSON.stringify({
            value: isOriginRead
              ? (origins[Math.min(read++, origins.length - 1)] ?? null)
              : { mutations: [], networkRequests: [], consoleLogs: [] }
          })
        )
      })
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
    const port = (server.address() as { port: number }).port
    const browser = makeMockBrowser({
      getLog: vi.fn(async () => []),
      sessionId: 'sess-anchor',
      transport: { settings: { webdriver: { host: '127.0.0.1', port } } }
    })
    return {
      browser,
      seen,
      close: () => new Promise<void>((r) => server.close(() => r()))
    }
  }

  // The destination used to be anchored only by a drain slow enough to land
  // after the navigation. `performance.timeOrigin` is the document's own birth
  // time, so a change in it IS the replacement, whatever the latency.
  it('drains once the document origin changes', async () => {
    const { browser, seen, close } = await driverServing([1000, 1000, 2000])
    const cap = makeCapturer(browser)
    cap.preloadRegistered = true
    try {
      await cap.anchorAfterNavigation(browser)
      expect(seen).toContain('drain')
    } finally {
      await close()
    }
  })

  // A command that navigated nowhere must not force an anchor of the page it
  // is already on. The first call establishes the baseline, so this asserts on
  // the second.
  it('does not drain when the document is never replaced', async () => {
    const { browser, seen, close } = await driverServing([1000])
    const cap = makeCapturer(browser)
    cap.preloadRegistered = true
    try {
      await cap.anchorAfterNavigation(browser)
      seen.length = 0
      await cap.anchorAfterNavigation(browser)
      expect(seen).not.toContain('drain')
    } finally {
      await close()
    }
  })

  // `browser.url` waits for load, so the run's first DOM-mutating command
  // normally completes with the destination already current. Baselining against
  // the document we are standing on would compare it with itself and drop the
  // anchor, leaving the trace on the page before it.
  it('anchors the first command even when its navigation already committed', async () => {
    const { browser, seen, close } = await driverServing([2000])
    const cap = makeCapturer(browser)
    cap.preloadRegistered = true
    try {
      await cap.anchorAfterNavigation(browser)
      expect(seen).toContain('drain')
    } finally {
      await close()
    }
  })
})
