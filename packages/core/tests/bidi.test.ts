import { describe, it, expect } from 'vitest'
import {
  arrayHeadersToObject,
  attachBidiHandlers,
  loadSeleniumSubmodule,
  handleBidiConsoleEntry,
  handleBidiJsException,
  attachNetworkInspector,
  handleBidiFetchError,
  handleBidiRequestSent,
  handleBidiResponseCompleted,
  type BidiHandlerSinks
} from '../src/bidi.js'
import type { NetworkRequest } from '@wdio/devtools-shared'

function makeSinks() {
  const consoleLogs: any[] = []
  const networkRequests: any[] = []
  const replacements: Array<{ id: string; entry: NetworkRequest }> = []
  const sinks: BidiHandlerSinks = {
    pushConsoleLog: (e) => consoleLogs.push(e),
    pushNetworkRequest: (e) => networkRequests.push(e),
    replaceNetworkRequest: (id, entry) => replacements.push({ id, entry })
  }
  return { sinks, consoleLogs, networkRequests, replacements }
}

const silentLog = () => {}

describe('arrayHeadersToObject', () => {
  it('flattens BiDi { name, value: string } headers to a lowercased dict', () => {
    expect(
      arrayHeadersToObject([
        { name: 'Content-Type', value: 'application/json' },
        { name: 'X-Foo', value: 'bar' }
      ])
    ).toEqual({ 'content-type': 'application/json', 'x-foo': 'bar' })
  })

  it('unwraps { value: { value: string } } shape (BiDi sometimes wraps)', () => {
    expect(
      arrayHeadersToObject([
        { name: 'Accept', value: { type: 'string', value: 'text/html' } }
      ])
    ).toEqual({ accept: 'text/html' })
  })

  it('falls back to JSON.stringify when value is neither string nor wrapped string', () => {
    expect(
      arrayHeadersToObject([
        { name: 'X-Weird', value: { type: 'object' } as unknown as string }
      ])
    ).toEqual({ 'x-weird': '{"type":"object"}' })
  })

  it('returns undefined for non-array input + skips entries with empty names', () => {
    expect(arrayHeadersToObject(undefined)).toBeUndefined()
    expect(arrayHeadersToObject('not-an-array')).toBeUndefined()
    expect(
      arrayHeadersToObject([
        { name: '', value: 'skipped' },
        { name: 'kept', value: 'v' }
      ])
    ).toEqual({ kept: 'v' })
  })
})

describe('loadSeleniumSubmodule', () => {
  it('returns null for a submodule that does not exist anywhere', () => {
    expect(
      loadSeleniumSubmodule('definitely/not/a/real/submodule-xyz123')
    ).toBeNull()
  })
})

describe('handleBidiConsoleEntry', () => {
  it('pushes a console-log entry with the chrome-mapped level and text', () => {
    const { sinks, consoleLogs } = makeSinks()
    handleBidiConsoleEntry(
      { level: 'WARNING', text: 'careful', timestamp: 1700 },
      sinks,
      silentLog
    )
    expect(consoleLogs).toHaveLength(1)
    expect(consoleLogs[0].timestamp).toBe(1700)
    expect(consoleLogs[0].type).toBe('warn')
    expect(consoleLogs[0].args).toEqual(['careful'])
    expect(consoleLogs[0].source).toBe('browser')
  })

  it('falls back to the entry.type when level is absent', () => {
    const { sinks, consoleLogs } = makeSinks()
    handleBidiConsoleEntry(
      { type: 'SEVERE', message: 'oops' },
      sinks,
      silentLog
    )
    expect(consoleLogs[0].type).toBe('error')
    expect(consoleLogs[0].args).toEqual(['oops'])
  })

  it('defaults to "info" and current time when nothing is set', () => {
    const { sinks, consoleLogs } = makeSinks()
    handleBidiConsoleEntry({}, sinks, silentLog)
    expect(consoleLogs[0].type).toBe('info')
    expect(consoleLogs[0].timestamp).toBeGreaterThan(0)
    expect(consoleLogs[0].args).toEqual([''])
  })

  it('reports a warning when the sink throws', () => {
    const sinks: BidiHandlerSinks = {
      pushConsoleLog: () => {
        throw new Error('sink broke')
      },
      pushNetworkRequest: () => {},
      replaceNetworkRequest: () => {}
    }
    const logs: Array<[string, string]> = []
    handleBidiConsoleEntry({ text: 'x' }, sinks, (lvl, msg) =>
      logs.push([lvl, msg])
    )
    expect(logs.some(([lvl, msg]) => lvl === 'warn' && /threw/.test(msg))).toBe(
      true
    )
  })
})

describe('handleBidiJsException', () => {
  it('logs a JS-error notice and pushes a "browser console" error entry', () => {
    const { sinks, consoleLogs } = makeSinks()
    const logs: Array<[string, string]> = []
    handleBidiJsException(
      { text: 'TypeError: x is undefined' },
      sinks,
      (lvl, msg) => logs.push([lvl, msg])
    )
    expect(consoleLogs).toHaveLength(1)
    expect(consoleLogs[0].type).toBe('error')
    expect(consoleLogs[0].args[0]).toBe('TypeError: x is undefined')
    expect(logs.some(([, msg]) => msg.includes('JS error in page'))).toBe(true)
  })

  it('truncates long messages with an ellipsis in the warn line', () => {
    const long = 'x'.repeat(500)
    const logs: Array<[string, string]> = []
    handleBidiJsException({ text: long }, makeSinks().sinks, (lvl, msg) =>
      logs.push([lvl, msg])
    )
    const warning = logs.find(([, msg]) => msg.includes('JS error'))![1]
    expect(warning).toContain('…')
    expect(warning.length).toBeLessThan(500)
  })

  it('stringifies the raw value when neither text nor message is present', () => {
    const { sinks, consoleLogs } = makeSinks()
    handleBidiJsException('plain string', sinks, silentLog)
    expect(consoleLogs[0].args[0]).toBe('plain string')
  })
})

describe('handleBidiRequestSent', () => {
  it('records a pending request and pushes to the sink', () => {
    const { sinks, networkRequests } = makeSinks()
    const pending = new Map<string, NetworkRequest>()
    handleBidiRequestSent(
      {
        request: {
          request: 'req-1',
          url: 'https://api.example.com/users',
          method: 'GET',
          headers: [{ name: 'Accept', value: 'application/json' }]
        },
        timestamp: 1234
      },
      pending,
      sinks,
      silentLog
    )
    expect(networkRequests).toHaveLength(1)
    expect(networkRequests[0].url).toBe('https://api.example.com/users')
    expect(networkRequests[0].method).toBe('GET')
    expect(networkRequests[0].requestHeaders).toEqual({
      accept: 'application/json'
    })
    expect(pending.has('req-1')).toBe(true)
  })

  it('skips emission when no requestId is present', () => {
    const { sinks, networkRequests } = makeSinks()
    const pending = new Map<string, NetworkRequest>()
    handleBidiRequestSent({}, pending, sinks, silentLog)
    expect(networkRequests).toHaveLength(0)
    expect(pending.size).toBe(0)
  })

  it('defaults method to GET when not supplied', () => {
    const { sinks, networkRequests } = makeSinks()
    handleBidiRequestSent(
      { request: { request: 'r', url: 'https://x.test/' } },
      new Map(),
      sinks,
      silentLog
    )
    expect(networkRequests[0].method).toBe('GET')
  })
})

describe('handleBidiResponseCompleted', () => {
  it('replaces the matching pending entry with status + headers + size', () => {
    const { sinks, networkRequests, replacements } = makeSinks()
    const pending = new Map<string, NetworkRequest>()
    handleBidiRequestSent(
      {
        request: {
          request: 'req-2',
          url: 'https://api.example.com/x',
          method: 'POST'
        },
        timestamp: 100
      },
      pending,
      sinks,
      silentLog
    )
    handleBidiResponseCompleted(
      {
        request: { request: 'req-2' },
        timestamp: 350,
        response: {
          status: 201,
          statusText: 'Created',
          headers: [{ name: 'Content-Type', value: 'application/json' }],
          mimeType: 'application/json',
          bytesReceived: 1024
        }
      },
      pending,
      sinks,
      silentLog
    )
    expect(replacements).toHaveLength(1)
    expect(replacements[0].id).toBe('req-2')
    expect(replacements[0].entry.status).toBe(201)
    expect(replacements[0].entry.statusText).toBe('Created')
    expect(replacements[0].entry.size).toBe(1024)
    // pending entry is consumed
    // Kept: a redirect hop or a late failure for this id continues the row.
    expect(pending.has('req-2')).toBe(true)
    // pushNetworkRequest fired during requestSent, replaceNetworkRequest on completion
    expect(networkRequests).toHaveLength(1)
  })

  it('derives duration from FetchTimingInfo even when event timestamps are identical (batched delivery)', () => {
    const { sinks, replacements } = makeSinks()
    const pending = new Map<string, NetworkRequest>()
    // Both events share timestamp 500 — as happens when BiDi delivers them in
    // one tick. The timestamp diff is 0, but the timings give the real duration
    // (responseEnd - requestTime), anchored to the start time.
    const timings = { requestTime: 0, responseEnd: 150 }
    handleBidiRequestSent(
      {
        request: {
          request: 'req-t',
          url: 'https://x/a',
          method: 'GET',
          timings
        },
        timestamp: 500
      },
      pending,
      sinks,
      silentLog
    )
    handleBidiResponseCompleted(
      {
        request: { request: 'req-t', timings },
        timestamp: 500,
        response: { status: 200 }
      },
      pending,
      sinks,
      silentLog
    )
    const entry = replacements[0].entry
    expect(entry.startTime).toBe(500) // beforeRequestSent event timestamp
    expect(entry.time).toBe(150) // responseEnd - requestTime
    expect(entry.endTime).toBe(650) // startTime + duration
  })

  it('is a no-op when the requestId is not in the pending map', () => {
    const { sinks, replacements } = makeSinks()
    handleBidiResponseCompleted(
      { request: { request: 'unknown' }, response: {} },
      new Map(),
      sinks,
      silentLog
    )
    expect(replacements).toHaveLength(0)
  })
})

describe('handleBidi* under selenium-webdriver dispatch', () => {
  // selenium-webdriver's NetworkInspector hands every network event to every
  // subscriber's callback, so each handler also receives the other's events.
  const requestEvent = {
    request: { request: 'R1', url: 'https://x/', method: 'GET', headers: [] },
    timestamp: 1,
    initiator: { type: 'other' }
  }
  const responseEvent = {
    request: { request: 'R1', url: 'https://x/', method: 'GET', headers: [] },
    timestamp: 2,
    response: {
      status: 200,
      headers: [{ name: 'content-type', value: 'text/html' }]
    }
  }

  it('ignores a response event delivered to the request handler', () => {
    const { sinks, networkRequests } = makeSinks()
    const pending = new Map<string, NetworkRequest>()
    handleBidiRequestSent(responseEvent, pending, sinks, silentLog)
    expect(networkRequests).toEqual([])
    expect(pending.size).toBe(0)
  })

  it('ignores a request event delivered to the response handler', () => {
    const { sinks, replacements } = makeSinks()
    const pending = new Map<string, NetworkRequest>()
    handleBidiRequestSent(requestEvent, pending, sinks, silentLog)
    handleBidiResponseCompleted(requestEvent, pending, sinks, silentLog)
    expect(replacements).toEqual([])
    expect(pending.has('R1')).toBe(true)
  })

  it('leaves one row per request when both handlers see both events', () => {
    // The sequence as the inspector delivers it: every event to every handler.
    const { sinks, networkRequests, replacements } = makeSinks()
    const pending = new Map<string, NetworkRequest>()
    for (const event of [requestEvent, responseEvent]) {
      handleBidiRequestSent(event, pending, sinks, silentLog)
      handleBidiResponseCompleted(event, pending, sinks, silentLog)
    }
    expect(networkRequests).toHaveLength(1)
    expect(replacements).toHaveLength(1)
    expect(replacements[0]).toMatchObject({
      id: 'R1',
      entry: { id: 'R1', status: 200 }
    })
    expect(pending.size).toBe(1)
  })

  it('ignores a failure event delivered to the request handler', () => {
    const { sinks, networkRequests, replacements } = makeSinks()
    const pending = new Map<string, NetworkRequest>()
    handleBidiRequestSent(requestEvent, pending, sinks, silentLog)
    handleBidiRequestSent(
      {
        request: { request: 'R1' },
        timestamp: 3,
        errorText: 'net::ERR_BLOCKED'
      },
      pending,
      sinks,
      silentLog
    )
    expect(networkRequests).toHaveLength(1)
    expect(replacements).toEqual([])
  })

  it('moves a redirected request’s row instead of adding one', () => {
    const { sinks, networkRequests, replacements } = makeSinks()
    const pending = new Map<string, NetworkRequest>()
    handleBidiRequestSent(requestEvent, pending, sinks, silentLog)
    handleBidiRequestSent(
      {
        ...requestEvent,
        request: { ...requestEvent.request, url: 'https://x/moved' },
        redirectCount: 1
      },
      pending,
      sinks,
      silentLog
    )
    expect(networkRequests).toHaveLength(1)
    expect(replacements).toEqual([
      { id: 'R1', entry: expect.objectContaining({ url: 'https://x/moved' }) }
    ])
  })

  it('moves a redirect hop onto the row its completed hop left', () => {
    // Chrome completes the 302 before re-sending the request under the same
    // id; the row left `pending` with it, and a fresh push listed the hop
    // twice: once finalized, once pending for the rest of the session.
    const { sinks, networkRequests, replacements } = makeSinks()
    const pending = new Map<string, NetworkRequest>()
    handleBidiRequestSent(requestEvent, pending, sinks, silentLog)
    handleBidiResponseCompleted(
      { ...responseEvent, response: { status: 302, headers: [] } },
      pending,
      sinks,
      silentLog
    )
    handleBidiRequestSent(
      {
        ...requestEvent,
        request: { ...requestEvent.request, url: 'https://x/secure' },
        redirectCount: 1
      },
      pending,
      sinks,
      silentLog
    )
    handleBidiResponseCompleted(responseEvent, pending, sinks, silentLog)
    expect(networkRequests).toHaveLength(1)
    // The row ends on the url the chain landed on, with the final status.
    expect(replacements.map((r) => r.entry.url)).toEqual([
      'https://x/',
      'https://x/secure',
      'https://x/secure'
    ])
    expect(replacements.at(-1)?.entry.status).toBe(200)
    // The chain's clock is the first hop's, so its duration spans the chain.
    expect(replacements.at(-1)?.entry.startTime).toBe(1)
    expect(pending.size).toBe(1)
  })

  it('closes a request the browser gave up on as a failure, not a pending row', () => {
    const { sinks, replacements } = makeSinks()
    const pending = new Map<string, NetworkRequest>()
    handleBidiRequestSent(requestEvent, pending, sinks, silentLog)
    handleBidiFetchError(
      {
        request: { request: 'R1' },
        timestamp: 3,
        errorText: 'net::ERR_BLOCKED'
      },
      pending,
      sinks,
      silentLog
    )
    expect(replacements).toHaveLength(1)
    expect(replacements[0].entry).toMatchObject({
      id: 'R1',
      status: 0,
      statusText: 'net::ERR_BLOCKED',
      error: 'net::ERR_BLOCKED'
    })
    expect(pending.size).toBe(1)
  })

  it('ignores a failure for a request it never saw', () => {
    const { sinks, replacements } = makeSinks()
    handleBidiFetchError(
      { request: { request: 'R9' }, errorText: 'net::ERR_BLOCKED' },
      new Map(),
      sinks,
      silentLog
    )
    expect(replacements).toEqual([])
  })
})

describe('attachNetworkInspector and the socket it reads failures from', () => {
  /** A selenium-webdriver inspector: callbacks per event, and the BiDi
   *  connection it subscribed on, whose socket carries every frame. */
  function fakeInspector({ refuse = false } = {}) {
    const callbacks: Record<string, (e: unknown) => void> = {}
    const listeners: ((raw: unknown) => void)[] = []
    const subscribed: string[] = []
    const inspector = {
      beforeRequestSent: async (cb: (e: unknown) => void) => {
        callbacks.request = cb
      },
      responseCompleted: async (cb: (e: unknown) => void) => {
        callbacks.response = cb
      },
      bidi: {
        subscribe: async (events: string | string[]) => {
          if (refuse) {
            throw new Error('unknown event')
          }
          subscribed.push(...(Array.isArray(events) ? events : [events]))
        },
        socket: {
          on: (_event: 'message', listener: (raw: unknown) => void) => {
            listeners.push(listener)
          }
        }
      }
    }
    const raw = (text: string) =>
      listeners.forEach((listener) => listener(Buffer.from(text)))
    const frame = (method: string, params: unknown) =>
      raw(JSON.stringify({ method, params }))
    return { inspector, callbacks, subscribed, frame, raw }
  }

  it('closes a request the browser gave up on through the socket', async () => {
    const { sinks, replacements } = makeSinks()
    const { inspector, callbacks, subscribed, frame } = fakeInspector()
    const attached = await attachNetworkInspector(
      {},
      async () => inspector,
      sinks,
      silentLog
    )
    expect(attached).toBe(true)
    expect(subscribed).toEqual(['network.fetchError'])
    callbacks.request({
      request: { request: 'R1', url: 'https://x/beacon', method: 'GET' },
      timestamp: 1,
      initiator: { type: 'other' }
    })
    frame('network.fetchError', {
      request: { request: 'R1' },
      timestamp: 2,
      errorText: 'net::ERR_BLOCKED_BY_CLIENT'
    })
    expect(replacements).toHaveLength(1)
    expect(replacements[0].entry).toMatchObject({
      status: 0,
      error: 'net::ERR_BLOCKED_BY_CLIENT'
    })
  })

  it('reads only failure frames off the socket, and only JSON ones', async () => {
    const { sinks, networkRequests, replacements } = makeSinks()
    const { inspector, callbacks, frame, raw } = fakeInspector()
    await attachNetworkInspector({}, async () => inspector, sinks, silentLog)
    callbacks.request({
      request: { request: 'R1', url: 'https://x/', method: 'GET' },
      timestamp: 1,
      initiator: { type: 'other' }
    })
    frame('network.responseCompleted', {
      request: { request: 'R1' },
      response: { status: 200, headers: [] }
    })
    expect(() => raw('not json')).not.toThrow()
    expect(replacements).toEqual([])
    expect(networkRequests).toHaveLength(1)
  })

  it('stays attached when the browser refuses the failure subscription', async () => {
    const warnings: string[] = []
    const { sinks, networkRequests } = makeSinks()
    const { inspector, callbacks } = fakeInspector({ refuse: true })
    const attached = await attachNetworkInspector(
      {},
      async () => inspector,
      sinks,
      (level, message) => level === 'warn' && warnings.push(message)
    )
    expect(attached).toBe(true)
    expect(warnings.join('\n')).toContain('network.fetchError unavailable')
    callbacks.request({
      request: { request: 'R1', url: 'https://x/', method: 'GET' },
      timestamp: 1,
      initiator: { type: 'other' }
    })
    expect(networkRequests).toHaveLength(1)
  })
})

describe('attachBidiHandlers — graceful degradation', () => {
  // Two real-world failure modes the function must handle without crashing:
  //   (a) submodules unresolvable → "not available" notice, returns false
  //   (b) submodules load but driver is fake / pre-BiDi → attach attempt
  //       throws inside the factory, caught + logged as "attach failed",
  //       returns false
  // selenium-webdriver IS installed in this workspace, so we exercise (b).
  it('returns false and never throws when the driver is not BiDi-capable', async () => {
    const sinks: BidiHandlerSinks = {
      pushConsoleLog: () => {},
      pushNetworkRequest: () => {},
      replaceNetworkRequest: () => {}
    }
    const logs: Array<[string, string]> = []
    const ok = await attachBidiHandlers({}, sinks, (lvl, msg) =>
      logs.push([lvl, msg])
    )
    expect(ok).toBe(false)
    // Either the submodule was missing OR the inspector attach threw —
    // both produce a notice via the onLog hook.
    const noticed = logs.some(
      ([, msg]) =>
        msg.includes('not available') || msg.includes('attach failed')
    )
    expect(noticed).toBe(true)
  })
})

describe('attachNetworkInspector with an inspector that has a fetchError hook', () => {
  const requestEventFor = (id: string) => ({
    request: { request: id, url: `https://x/${id}`, method: 'GET' },
    timestamp: 1,
    initiator: { type: 'other' }
  })

  it('subscribes through the hook and reads nothing off the socket', async () => {
    const { sinks, replacements } = makeSinks()
    const callbacks: Record<string, (e: unknown) => void> = {}
    const subscribed: string[] = []
    const inspector = {
      beforeRequestSent: async (cb: (e: unknown) => void) => {
        callbacks.request = cb
      },
      responseCompleted: async (cb: (e: unknown) => void) => {
        callbacks.response = cb
      },
      fetchError: async (cb: (e: unknown) => void) => {
        callbacks.failure = cb
      },
      bidi: {
        subscribe: async (events: string | string[]) => {
          subscribed.push(...(Array.isArray(events) ? events : [events]))
        },
        socket: { on: () => {} }
      }
    }
    await attachNetworkInspector({}, async () => inspector, sinks, silentLog)
    expect(subscribed).toEqual([])
    callbacks.request(requestEventFor('R1'))
    // selenium-webdriver hands every network event to every hook's callback.
    callbacks.failure(requestEventFor('R1'))
    expect(replacements).toEqual([])
    callbacks.failure({
      request: { request: 'R1' },
      timestamp: 2,
      errorText: 'net::ERR_FAILED'
    })
    expect(replacements).toHaveLength(1)
    expect(replacements[0].entry).toMatchObject({
      status: 0,
      error: 'net::ERR_FAILED'
    })
  })

  it('keeps a row still open when the session outgrows the tracked set', () => {
    const { sinks, replacements } = makeSinks()
    const rows = new Map<string, NetworkRequest>()
    handleBidiRequestSent(requestEventFor('open'), rows, sinks, silentLog)
    for (let i = 0; i < 5000; i++) {
      const id = `done-${i}`
      handleBidiRequestSent(requestEventFor(id), rows, sinks, silentLog)
      handleBidiResponseCompleted(
        {
          request: { request: id },
          timestamp: 2,
          response: { status: 200, headers: [] }
        },
        rows,
        sinks,
        silentLog
      )
    }
    expect(rows.size).toBe(5000)
    expect(rows.has('open')).toBe(true)
    handleBidiFetchError(
      {
        request: { request: 'open' },
        timestamp: 3,
        errorText: 'net::ERR_ABORTED'
      },
      rows,
      sinks,
      silentLog
    )
    expect(replacements.at(-1)?.entry).toMatchObject({ id: 'open', status: 0 })
  })
})
