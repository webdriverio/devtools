import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SessionCapturer } from '../src/session.js'
import type { NightwatchBrowser } from '../src/types.js'

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
    expect((cap.commandsLog[0] as { _id: number })._id).not.toBe(
      (cap.commandsLog[1] as { _id: number })._id
    )
  })

  it('uses provided timestamp when given', async () => {
    const cap = makeCapturer()
    await cap.captureCommand(
      'x',
      [],
      undefined,
      undefined,
      undefined,
      undefined,
      12345
    )
    expect(cap.commandsLog[0].timestamp).toBe(12345)
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
})

describe('SessionCapturer.replaceCommand', () => {
  it('splices the old entry and reissues with a new _id', async () => {
    const cap = makeCapturer()
    await cap.captureCommand('click', ['#a'], undefined, undefined)
    const oldId = (cap.commandsLog[0] as { _id: number })._id
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
    expect((cap.commandsLog[0] as { _id: number })._id).not.toBe(oldId)
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
    await expect(
      cap.captureNetworkFromPerformanceLogs(browser)
    ).resolves.toBeUndefined()
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
    let call = 0
    const browser = makeMockBrowser({
      getLog: vi.fn(async () => []),
      execute: vi.fn(async () => {
        call++
        if (call === 1) {
          // collector check
          return { value: true }
        }
        // getTraceData
        return {
          value: {
            mutations: [
              { type: 'attributes', addedNodes: [], removedNodes: [] }
            ],
            networkRequests: [],
            consoleLogs: []
          }
        }
      })
    })
    const cap = makeCapturer(browser)
    await cap.captureTrace(browser)
    expect(call).toBe(2)
  })
})
