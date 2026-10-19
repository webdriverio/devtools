import {
  NETWORK_CAPTURE_SOURCE,
  type NetworkRequest
} from '@wdio/devtools-shared'
import { describe, expect, it } from 'vitest'
import {
  parseNetworkFromPerfLogs,
  upgradeResourceTimingRows,
  withoutLoadsTheLogListed,
  type LoadListedByLog,
  type NetworkEntry,
  type PerfLogEntry
} from '../src/helpers/perfLogs.js'

/** A row the page's Resource Timing reported before the log was read. */
function resourceTimingRow(
  overrides: Partial<NetworkRequest> = {}
): NetworkRequest {
  return {
    id: 'rt-1760000000500-abc',
    url: 'https://x/a.js',
    method: '',
    type: 'script',
    timestamp: 1_760_000_000_500,
    startTime: 500,
    endTime: 540,
    time: 40,
    timings: { blocked: 1, dns: 2, connect: 3, send: 0, wait: 20, receive: 4 },
    source: NETWORK_CAPTURE_SOURCE.RESOURCE_TIMING,
    ...overrides
  }
}

/** A perf-log entry for the same load, carrying what the page could not see. */
function logEntry(overrides: Partial<NetworkEntry> = {}): NetworkEntry {
  return {
    id: '1000-R1',
    url: 'https://x/a.js',
    method: 'GET',
    requestHeaders: { accept: '*/*' },
    timestamp: 1_760_000_000_520,
    startTime: 2000,
    status: 200,
    statusText: 'OK',
    responseHeaders: { 'content-type': 'text/javascript' },
    type: 'script',
    size: 900,
    ...overrides
  }
}

describe('upgradeResourceTimingRows', () => {
  it('pairs a log entry with the page row for the same load, under the row id', () => {
    const existing = [resourceTimingRow()]
    const { upgrades, fresh } = upgradeResourceTimingRows(
      [logEntry()],
      existing
    )
    expect(fresh).toEqual([])
    expect(upgrades).toHaveLength(1)
    expect(upgrades[0].index).toBe(0)
    expect(upgrades[0].request).toMatchObject({
      id: 'rt-1760000000500-abc',
      method: 'GET',
      status: 200,
      statusText: 'OK',
      requestHeaders: { accept: '*/*' },
      responseHeaders: { 'content-type': 'text/javascript' },
      size: 900
    })
    expect(upgrades[0].request.source).toBeUndefined()
  })

  it('keeps the page’s clock and measured phases under the log’s detail', () => {
    // The page's row is on the document's clock, the log's on the driver's;
    // mixing the two gives a row whose start and end are not comparable.
    const { upgrades } = upgradeResourceTimingRows(
      [logEntry({ startTime: 9000, endTime: 9050, time: 50 })],
      [resourceTimingRow()]
    )
    expect(upgrades[0].request).toMatchObject({
      timestamp: 1_760_000_000_500,
      startTime: 500,
      endTime: 540,
      time: 40,
      timings: { wait: 20 }
    })
  })

  it('matches by time, nearest first, and spends each row once', () => {
    const early = resourceTimingRow({
      id: 'rt-early',
      timestamp: 1_760_000_000_000
    })
    const late = resourceTimingRow({
      id: 'rt-late',
      timestamp: 1_760_000_003_000
    })
    const { upgrades } = upgradeResourceTimingRows(
      [
        logEntry({ id: 'L1', timestamp: 1_760_000_003_100 }),
        logEntry({ id: 'L2', timestamp: 1_760_000_000_050 }),
        logEntry({ id: 'L3', timestamp: 1_760_000_000_060 })
      ],
      [early, late]
    )
    expect(upgrades.map((u) => [u.request.id, u.index])).toEqual([
      ['rt-late', 1],
      ['rt-early', 0]
    ])
  })

  it('leaves an entry fresh when no page row is within tolerance', () => {
    const { upgrades, fresh } = upgradeResourceTimingRows(
      [logEntry({ timestamp: 1_760_000_009_000 })],
      [resourceTimingRow()]
    )
    expect(upgrades).toEqual([])
    expect(fresh).toHaveLength(1)
  })

  it('never pairs with a row another source reported', () => {
    const { upgrades, fresh } = upgradeResourceTimingRows(
      [logEntry()],
      [resourceTimingRow({ source: undefined })]
    )
    expect(upgrades).toEqual([])
    expect(fresh).toHaveLength(1)
  })

  it('keeps the page’s type where the log never resolved one', () => {
    const { upgrades } = upgradeResourceTimingRows(
      [logEntry({ type: undefined })],
      [resourceTimingRow()]
    )
    expect(upgrades[0].request.type).toBe('script')
  })
})

describe('withoutLoadsTheLogListed', () => {
  /** A load the log listed before the drain, dated from the driver's clock. */
  const listed = (
    overrides: Partial<LoadListedByLog> = {}
  ): LoadListedByLog => ({
    url: 'https://x/a.js',
    timestamp: 1_760_000_000_520,
    ...overrides
  })

  it('drops the page’s row for the load the log listed, and nothing else', () => {
    const fresh = resourceTimingRow({ id: 'rt-2', url: 'https://x/b.js' })
    const payload = withoutLoadsTheLogListed(
      { mutations: [], networkRequests: [resourceTimingRow(), fresh] },
      [listed()]
    )
    expect(payload.networkRequests).toEqual([fresh])
    expect(payload.mutations).toEqual([])
  })

  it('keeps the row when the url or the clock differs', () => {
    const rows = [resourceTimingRow()]
    expect(
      withoutLoadsTheLogListed({ networkRequests: rows }, [
        listed({ url: 'https://x/b.js' })
      ]).networkRequests
    ).toEqual(rows)
    expect(
      withoutLoadsTheLogListed({ networkRequests: rows }, [
        listed({ timestamp: 1_760_000_003_000 })
      ]).networkRequests
    ).toEqual(rows)
  })

  it('spends a listed load on one row, so a repeated request keeps its own', () => {
    // Two requests to one url inside the window, the first listed by the log
    // before the drain: the second is a request of its own, not the first's
    // second listing.
    const first = resourceTimingRow({ id: 'rt-first' })
    const second = resourceTimingRow({
      id: 'rt-second',
      timestamp: 1_760_000_001_000
    })
    const payload = withoutLoadsTheLogListed(
      { networkRequests: [first, second] },
      [listed()]
    )
    expect(payload.networkRequests).toEqual([second])
  })

  it('takes the row nearest the listed load in time', () => {
    const early = resourceTimingRow({
      id: 'rt-early',
      timestamp: 1_760_000_000_000
    })
    const late = resourceTimingRow({
      id: 'rt-late',
      timestamp: 1_760_000_001_000
    })
    const payload = withoutLoadsTheLogListed(
      { networkRequests: [early, late] },
      [listed({ timestamp: 1_760_000_000_900 })]
    )
    expect(payload.networkRequests).toEqual([early])
  })

  it('never takes a row another source reported', () => {
    // The patch's own fetch row shares the url; it is a request of its own
    // and carries the body nothing else captured.
    const patched = resourceTimingRow({ id: 'fetch-1', source: undefined })
    const payload = withoutLoadsTheLogListed({ networkRequests: [patched] }, [
      listed()
    ])
    expect(payload.networkRequests).toEqual([patched])
  })

  it('returns a payload without requests, or with nothing listed, as it is', () => {
    const noRequests = { mutations: [] }
    expect(withoutLoadsTheLogListed(noRequests, [listed()])).toBe(noRequests)
    const nothingListed = { networkRequests: [resourceTimingRow()] }
    expect(withoutLoadsTheLogListed(nothingListed, [])).toBe(nothingListed)
  })
})

/** Build a perf-log entry. `wrapperTs` is the WebDriver batch timestamp (often
 *  identical across a batch); the CDP monotonic time (seconds) lives in
 *  `params.timestamp`. */
function entry(
  method: string,
  params: object,
  wrapperTs: number
): PerfLogEntry {
  return {
    level: 'INFO',
    timestamp: wrapperTs,
    message: JSON.stringify({ message: { method, params } })
  }
}

describe('parseNetworkFromPerfLogs timing', () => {
  it('derives duration from CDP event timestamps, not the log batch timestamp', () => {
    // Every entry shares the same wrapper timestamp (1000) — the old code
    // diffed those and produced time: 0. The CDP timestamps are 2.0s → 2.15s.
    const logs = [
      entry(
        'Network.requestWillBeSent',
        {
          requestId: '1',
          request: { url: 'https://x/a', method: 'GET' },
          timestamp: 2.0
        },
        1000
      ),
      entry(
        'Network.responseReceived',
        {
          requestId: '1',
          response: { status: 200, headers: {} },
          timestamp: 2.1
        },
        1000
      ),
      entry(
        'Network.loadingFinished',
        { requestId: '1', timestamp: 2.15, encodedDataLength: 512 },
        1000
      )
    ]

    const [req] = parseNetworkFromPerfLogs(logs)
    expect(req.startTime).toBe(2000)
    expect(req.endTime).toBe(2150)
    expect(req.time).toBe(150)
    expect(req.status).toBe(200)
    expect(req.size).toBe(512)
  })

  it('dates the request by its wall clock beside the monotonic span', () => {
    // Every consumer dates a row by `timestamp`, and the page's own row for
    // the same load is on epoch time; the monotonic clock only diffs within
    // a session.
    const logs = [
      entry(
        'Network.requestWillBeSent',
        {
          requestId: '1',
          request: { url: 'https://x/a', method: 'GET' },
          timestamp: 2.0,
          wallTime: 1760000000.5
        },
        1000
      ),
      entry(
        'Network.responseReceived',
        {
          requestId: '1',
          response: { status: 200, headers: {} },
          timestamp: 2.1
        },
        1000
      ),
      entry(
        'Network.loadingFinished',
        { requestId: '1', timestamp: 2.15 },
        1000
      )
    ]
    expect(parseNetworkFromPerfLogs(logs)[0]).toMatchObject({
      timestamp: 1_760_000_000_500,
      startTime: 2000,
      endTime: 2150,
      time: 150
    })
  })

  it('dates the request by the log batch when the event carries no wall clock', () => {
    const logs = [
      entry(
        'Network.requestWillBeSent',
        {
          requestId: '1',
          request: { url: 'https://x/a', method: 'GET' },
          timestamp: 2.0
        },
        1000
      ),
      entry(
        'Network.responseReceived',
        {
          requestId: '1',
          response: { status: 200, headers: {} },
          timestamp: 2.1
        },
        1000
      ),
      entry(
        'Network.loadingFinished',
        { requestId: '1', timestamp: 2.15 },
        1000
      )
    ]
    expect(parseNetworkFromPerfLogs(logs)[0].timestamp).toBe(1000)
  })

  it('never produces a negative duration', () => {
    const logs = [
      entry(
        'Network.requestWillBeSent',
        {
          requestId: '2',
          request: { url: 'https://x/b', method: 'GET' },
          timestamp: 5
        },
        1
      ),
      entry(
        'Network.responseReceived',
        {
          requestId: '2',
          response: { status: 200, headers: {} },
          timestamp: 5
        },
        1
      ),
      entry(
        'Network.loadingFinished',
        { requestId: '2', timestamp: 4.9, encodedDataLength: 1 },
        1
      )
    ]
    expect(parseNetworkFromPerfLogs(logs)[0].time).toBe(0)
  })
})
