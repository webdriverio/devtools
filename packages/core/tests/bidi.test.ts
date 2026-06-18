import { describe, it, expect } from 'vitest'
import {
  arrayHeadersToObject,
  attachBidiHandlers,
  loadSeleniumSubmodule,
  handleBidiConsoleEntry,
  handleBidiJsException,
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
    expect(pending.has('req-2')).toBe(false)
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
