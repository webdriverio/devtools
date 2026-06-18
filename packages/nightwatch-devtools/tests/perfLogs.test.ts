import { describe, expect, it } from 'vitest'
import {
  parseNetworkFromPerfLogs,
  type PerfLogEntry
} from '../src/helpers/perfLogs.js'

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
