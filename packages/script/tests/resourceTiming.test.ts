/** @vitest-environment happy-dom */
import { NETWORK_CAPTURE_SOURCE } from '@wdio/devtools-shared'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { ResourceTimingCollector } from '../src/collectors/resourceTiming.js'

type Entry = Record<string, unknown> & { name: string; entryType: string }

/** A resource entry as Chromium reports one that allowed timing: every phase
 *  set, a status, and a transfer size. Overrides shape the edge cases. */
function resource(overrides: Partial<Entry> = {}): Entry {
  return {
    name: 'https://app.test/static/app.js',
    entryType: 'resource',
    initiatorType: 'script',
    startTime: 100,
    duration: 50,
    fetchStart: 100,
    domainLookupStart: 102,
    domainLookupEnd: 104,
    connectStart: 104,
    secureConnectionStart: 106,
    connectEnd: 110,
    requestStart: 111,
    responseStart: 140,
    responseEnd: 150,
    transferSize: 1200,
    encodedBodySize: 900,
    decodedBodySize: 2400,
    responseStatus: 200,
    ...overrides
  }
}

/** A navigation entry: the document itself, whose `duration` runs on to the
 *  load event rather than ending with the response. */
function navigation(overrides: Partial<Entry> = {}): Entry {
  return resource({
    name: 'https://app.test/login',
    entryType: 'navigation',
    initiatorType: 'navigation',
    startTime: 0,
    fetchStart: 1,
    domainLookupStart: 2,
    domainLookupEnd: 3,
    connectStart: 3,
    secureConnectionStart: 0,
    connectEnd: 5,
    requestStart: 6,
    responseStart: 30,
    responseEnd: 40,
    duration: 400,
    ...overrides
  })
}

/** Stands in for the browser's observer: construction records the callback,
 *  `deliver` plays entries into it the way a browser would. */
class FakeObserver {
  static callbacks: ((list: { getEntries: () => Entry[] }) => void)[] = []
  static observed: unknown[] = []

  constructor(callback: (list: { getEntries: () => Entry[] }) => void) {
    FakeObserver.callbacks.push(callback)
  }

  observe(options: unknown) {
    FakeObserver.observed.push(options)
  }

  static deliver(...entries: Entry[]) {
    for (const callback of FakeObserver.callbacks) {
      callback({ getEntries: () => entries })
    }
  }

  static reset() {
    FakeObserver.callbacks = []
    FakeObserver.observed = []
  }
}

const realObserver = globalThis.PerformanceObserver
let buffer: Record<string, Entry[]>

beforeEach(() => {
  FakeObserver.reset()
  buffer = { navigation: [], resource: [] }
  ;(globalThis as { PerformanceObserver: unknown }).PerformanceObserver =
    FakeObserver
  vi.spyOn(performance, 'getEntriesByType').mockImplementation(
    (type: string) => (buffer[type] ?? []) as unknown as PerformanceEntry[]
  )
})

afterEach(() => {
  ;(globalThis as { PerformanceObserver: unknown }).PerformanceObserver =
    realObserver
  vi.restoreAllMocks()
})

const neverClaimed = () => false

describe('ResourceTimingCollector: the buffer at construction', () => {
  it('reports what loaded before the collector existed', () => {
    // The whole point over the fetch/XHR patch: a `<script>`-injected
    // collector arrives after the document and its first resources loaded,
    // and the buffer still holds them.
    buffer.navigation = [navigation()]
    buffer.resource = [
      resource(),
      resource({
        name: 'https://app.test/static/logo.png',
        initiatorType: 'img'
      })
    ]

    const requests = new ResourceTimingCollector(neverClaimed).getArtifacts()

    expect(requests.map((r) => [r.url, r.type])).toEqual([
      ['https://app.test/login', 'document'],
      ['https://app.test/static/app.js', 'script'],
      ['https://app.test/static/logo.png', 'image']
    ])
    expect(
      requests.every((r) => r.source === NETWORK_CAPTURE_SOURCE.RESOURCE_TIMING)
    ).toBe(true)
  })

  it('reads the buffer before it observes, so no entry falls between', () => {
    buffer.resource = [resource()]
    const collector = new ResourceTimingCollector(neverClaimed)
    expect(collector.getArtifacts()).toHaveLength(1)
    expect(FakeObserver.observed).toEqual([
      { entryTypes: ['resource', 'navigation'] }
    ])
  })

  it('does not read the buffer again on a document a collector already reported', () => {
    // A re-injected collector lands on a page the previous one instrumented;
    // every load in the buffer would otherwise be listed a second time.
    buffer.resource = [resource()]
    const win = window as unknown as { wdioTraceCollector?: unknown }
    win.wdioTraceCollector = {}
    try {
      const collector = new ResourceTimingCollector(neverClaimed)
      expect(collector.getArtifacts()).toEqual([])
      FakeObserver.deliver(resource())
      expect(collector.getArtifacts()).toHaveLength(1)
    } finally {
      delete win.wdioTraceCollector
    }
  })

  it('captures from the buffer alone where no observer exists', () => {
    ;(globalThis as { PerformanceObserver: unknown }).PerformanceObserver =
      undefined
    buffer.resource = [resource()]
    expect(
      new ResourceTimingCollector(neverClaimed).getArtifacts()
    ).toHaveLength(1)
  })
})

describe('ResourceTimingCollector: observed entries', () => {
  it('appends entries the browser delivers after construction', () => {
    const collector = new ResourceTimingCollector(neverClaimed)
    FakeObserver.deliver(resource(), navigation())
    expect(collector.getArtifacts().map((r) => r.type)).toEqual([
      'script',
      'document'
    ])
  })

  it('records the navigation once, whichever path delivers it first', () => {
    // The seed may read the navigation entry and the observer deliver it again
    // once the load event completes it.
    buffer.navigation = [navigation()]
    const collector = new ResourceTimingCollector(neverClaimed)
    FakeObserver.deliver(navigation())
    expect(collector.getArtifacts()).toHaveLength(1)
  })

  it('waits for a navigation whose response has not ended', () => {
    // A streaming document is still downloading when a `<script>` in it runs;
    // the observer delivers the completed entry later.
    buffer.navigation = [navigation({ responseEnd: 0 })]
    const collector = new ResourceTimingCollector(neverClaimed)
    expect(collector.getArtifacts()).toHaveLength(0)
    FakeObserver.deliver(navigation())
    expect(collector.getArtifacts()).toHaveLength(1)
  })

  it('clear() empties the drained rows and keeps observing', () => {
    const collector = new ResourceTimingCollector(neverClaimed)
    FakeObserver.deliver(resource())
    collector.clear()
    expect(collector.getArtifacts()).toEqual([])
    FakeObserver.deliver(resource())
    expect(collector.getArtifacts()).toHaveLength(1)
  })
})

describe('ResourceTimingCollector: what the fetch/XHR patch already holds', () => {
  it('skips a fetch or XHR the patch claimed, consulting it with the entry', () => {
    const consume = vi.fn(() => true)
    const collector = new ResourceTimingCollector(consume)
    FakeObserver.deliver(
      resource({ name: 'https://app.test/api/me', initiatorType: 'fetch' }),
      resource({
        name: 'https://app.test/api/list',
        initiatorType: 'xmlhttprequest'
      })
    )
    expect(collector.getArtifacts()).toEqual([])
    expect(consume).toHaveBeenCalledWith(
      'https://app.test/api/me',
      100,
      expect.objectContaining({
        url: 'https://app.test/api/me',
        type: 'fetch',
        source: NETWORK_CAPTURE_SOURCE.RESOURCE_TIMING
      })
    )
  })

  it('keeps a fetch the patch never saw, with the method it cannot know', () => {
    // A fetch made before the collector was installed: the buffer is the only
    // record of it, and Resource Timing names no method.
    const collector = new ResourceTimingCollector(neverClaimed)
    FakeObserver.deliver(
      resource({ name: 'https://app.test/api/me', initiatorType: 'fetch' })
    )
    expect(collector.getArtifacts()[0]).toMatchObject({
      type: 'fetch',
      method: ''
    })
  })

  it('never asks the patch about a parser-initiated load', () => {
    const consume = vi.fn(() => true)
    new ResourceTimingCollector(consume)
    FakeObserver.deliver(resource({ initiatorType: 'img' }))
    expect(consume).not.toHaveBeenCalled()
  })
})

describe('ResourceTimingCollector: the row it builds', () => {
  it('stamps epoch time from the document origin and the response span, not duration', () => {
    const collector = new ResourceTimingCollector(neverClaimed)
    FakeObserver.deliver(navigation())
    const [row] = collector.getArtifacts()
    expect(row.timestamp).toBe(Math.round(performance.timeOrigin + 0))
    expect(row.startTime).toBe(0)
    expect(row.endTime).toBe(40)
    expect(row.time).toBe(40)
  })

  it('gives every row an id of its own, across collector instances', () => {
    // Two collectors on one document (a re-injection) must not hand the
    // dashboard rows that replace each other.
    const first = new ResourceTimingCollector(neverClaimed)
    const second = new ResourceTimingCollector(neverClaimed)
    FakeObserver.deliver(resource())
    const ids = [...first.getArtifacts(), ...second.getArtifacts()].map(
      (r) => r.id
    )
    expect(ids).toHaveLength(2)
    expect(new Set(ids).size).toBe(2)
    expect(ids[0]).toMatch(/^rt-\d+-[a-z0-9]+$/)
  })

  it('names GET only for loads the parser issues itself', () => {
    const collector = new ResourceTimingCollector(neverClaimed)
    FakeObserver.deliver(
      resource({ initiatorType: 'script' }),
      resource({ initiatorType: 'css', name: 'https://app.test/a.woff2' }),
      navigation(),
      resource({ initiatorType: 'beacon', name: 'https://app.test/beat' })
    )
    expect(collector.getArtifacts().map((r) => r.method)).toEqual([
      'GET',
      'GET',
      '',
      ''
    ])
  })

  it('classifies by initiator, then by extension, and never guesses', () => {
    const collector = new ResourceTimingCollector(neverClaimed)
    FakeObserver.deliver(
      resource({ initiatorType: 'css', name: 'https://app.test/a.woff2' }),
      resource({ initiatorType: 'link', name: 'https://app.test/a.css' }),
      resource({ initiatorType: 'iframe', name: 'https://app.test/frame' }),
      resource({ initiatorType: 'beacon', name: 'https://app.test/beat' }),
      resource({ initiatorType: 'other', name: 'https://app.test/blob' })
    )
    expect(collector.getArtifacts().map((r) => r.type)).toEqual([
      'font',
      'stylesheet',
      'document',
      'fetch',
      'other'
    ])
  })

  it('carries a status only where the browser reports one', () => {
    // Chromium reports `responseStatus`; Safari reports nothing, and 0 is what
    // a transport failure means elsewhere, so it must not be stamped.
    const collector = new ResourceTimingCollector(neverClaimed)
    FakeObserver.deliver(
      resource({ responseStatus: 304 }),
      resource({ responseStatus: 0 }),
      resource({ responseStatus: undefined })
    )
    expect(collector.getArtifacts().map((r) => r.status)).toEqual([
      304,
      undefined,
      undefined
    ])
    expect('status' in collector.getArtifacts()[1]).toBe(false)
  })

  it('sizes by transfer, then by body, and omits a size it never saw', () => {
    const collector = new ResourceTimingCollector(neverClaimed)
    FakeObserver.deliver(
      resource(),
      resource({ transferSize: 0, encodedBodySize: 900 }),
      resource({ transferSize: 0, encodedBodySize: 0, decodedBodySize: 0 })
    )
    expect(collector.getArtifacts().map((r) => r.size)).toEqual([
      1200,
      900,
      undefined
    ])
  })

  it('measures the phases a response exposed, and none it withheld', () => {
    // Cross-origin without Timing-Allow-Origin zeroes every phase; zeros would
    // read as an instant handshake rather than as withheld.
    const collector = new ResourceTimingCollector(neverClaimed)
    FakeObserver.deliver(
      resource(),
      navigation(),
      resource({
        requestStart: 0,
        responseStart: 0,
        domainLookupStart: 0,
        domainLookupEnd: 0,
        connectStart: 0,
        connectEnd: 0
      })
    )
    const [tls, plain, withheld] = collector.getArtifacts()
    expect(tls.timings).toEqual({
      blocked: 2,
      dns: 2,
      connect: 6,
      ssl: 4,
      send: 0,
      wait: 29,
      receive: 10
    })
    expect(plain.timings).toEqual({
      blocked: 2,
      dns: 1,
      connect: 2,
      send: 0,
      wait: 24,
      receive: 10
    })
    expect(withheld.timings).toBeUndefined()
  })

  it('ignores the URLs the fetch/XHR patch ignores', () => {
    const collector = new ResourceTimingCollector(neverClaimed)
    FakeObserver.deliver(
      resource({ name: 'data:image/png;base64,AAAA', initiatorType: 'img' }),
      resource({ name: 'blob:https://app.test/1234', initiatorType: 'img' }),
      resource({ name: 'https://app.test/favicon.ico', initiatorType: 'other' })
    )
    expect(collector.getArtifacts()).toEqual([])
  })
})
