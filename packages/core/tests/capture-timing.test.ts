import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CAPTURE_TIMING_ENV,
  captureTimingFileName,
  type CaptureTimingRecord
} from '@wdio/devtools-shared'
import { captureActionSnapshot } from '../src/action-snapshot.js'
import {
  CaptureTimer,
  captureTimingEnabled,
  formatCaptureTimingSummary,
  reportCaptureTiming,
  startCaptureTimer,
  summarizeCaptureTiming
} from '../src/capture-timing.js'

let outDir: string
const drained: string[] = []

async function drain(): Promise<CaptureTimingRecord[]> {
  const file = await reportCaptureTiming(outDir, (t) => drained.push(t))
  if (!file) {
    return []
  }
  const lines = fs.readFileSync(file, 'utf8').trim().split('\n')
  fs.rmSync(file)
  return lines.map((l) => JSON.parse(l) as CaptureTimingRecord)
}

beforeEach(() => {
  outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'capture-timing-'))
  drained.length = 0
})

afterEach(async () => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  await reportCaptureTiming(outDir, () => undefined)
  fs.rmSync(outDir, { recursive: true, force: true })
})

describe('capture timing switch', () => {
  it('is off unless the variable is set', () => {
    vi.stubEnv(CAPTURE_TIMING_ENV, '')
    expect(captureTimingEnabled()).toBe(false)
    expect(startCaptureTimer('click', 'action', false)).toBeUndefined()
  })

  it.each(['0', 'false', 'no', 'OFF'])('stays off for %s', (value) => {
    vi.stubEnv(CAPTURE_TIMING_ENV, value)
    expect(captureTimingEnabled()).toBe(false)
  })

  it.each(['1', 'true', 'yes'])('turns on for %s', (value) => {
    vi.stubEnv(CAPTURE_TIMING_ENV, value)
    expect(captureTimingEnabled()).toBe(true)
  })

  it('records nothing and writes no file while off', async () => {
    vi.stubEnv(CAPTURE_TIMING_ENV, '')
    await captureActionSnapshot({
      command: 'click',
      runScript: () => Promise.resolve([]),
      takeScreenshot: () => Promise.resolve('AA')
    })
    expect(await reportCaptureTiming(outDir, (t) => drained.push(t))).toBe(
      undefined
    )
    expect(drained).toEqual([])
    expect(fs.readdirSync(outDir)).toEqual([])
  })
})

describe('recording a capture', () => {
  beforeEach(() => {
    vi.stubEnv(CAPTURE_TIMING_ENV, '1')
  })

  it('times every issued probe in issue order, plus the processing step', async () => {
    await captureActionSnapshot({
      command: 'click',
      trigger: 'matcher-poll',
      getUrl: () => Promise.resolve('https://x.test/'),
      getTitle: () => Promise.resolve('X'),
      runScript: () => Promise.resolve([]),
      takeScreenshot: () => Promise.resolve('AA')
    })
    const [record] = await drain()
    expect(record).toMatchObject({
      command: 'click',
      trigger: 'matcher-poll',
      native: false
    })
    expect(record.probes.map((p) => p.probe)).toEqual([
      'url',
      'title',
      'accessibilityTree',
      'elements',
      'screenshot',
      'process'
    ])
    expect(record.probes.map((p) => p.empty)).toEqual([
      false,
      false,
      true,
      true,
      false,
      false
    ])
  })

  it('leaves out a probe the adapter cannot serve, and marks a native capture', async () => {
    await captureActionSnapshot({
      command: 'click',
      getPageSource: () => Promise.resolve('<hierarchy />'),
      takeScreenshot: () => Promise.resolve('AA'),
      platform: 'android'
    })
    const [record] = await drain()
    expect(record.native).toBe(true)
    expect(record.trigger).toBe('action')
    expect(record.probes.map((p) => p.probe)).toEqual([
      'pageSource',
      'screenshot',
      'process'
    ])
  })

  it('separates queueing from service time on a driver that serves one request at a time', async () => {
    let clock = 1000
    vi.spyOn(performance, 'now').mockImplementation(() => clock)
    const timer = new CaptureTimer('click', 'action', false)
    const resolvers: Array<(v: string) => void> = []
    const read = () =>
      new Promise<string>((resolve) => {
        resolvers.push(resolve)
      })
    const url = timer.track('url', read())
    const shot = timer.track('screenshot', read())
    clock = 1010
    resolvers[0]('u')
    await url
    clock = 1250
    resolvers[1]('s')
    await shot
    clock = 1255
    timer.finish(1250)
    const [record] = await drain()
    expect(record.total).toBe(255)
    expect(
      record.probes.map(({ probe, issued, settled, service }) => ({
        probe,
        issued,
        settled,
        service
      }))
    ).toEqual([
      { probe: 'url', issued: 0, settled: 10, service: 10 },
      { probe: 'screenshot', issued: 0, settled: 250, service: 240 },
      { probe: 'process', issued: 250, settled: 255, service: 5 }
    ])
  })

  it('returns the same snapshot whether timing is on or off', async () => {
    const input = {
      command: 'click',
      timestamp: 5,
      getUrl: () => Promise.resolve('https://x.test/'),
      getTitle: () => Promise.resolve('X'),
      runScript: () => Promise.resolve([]),
      takeScreenshot: () => Promise.resolve('AA')
    }
    const on = await captureActionSnapshot(input)
    vi.stubEnv(CAPTURE_TIMING_ENV, '')
    const off = await captureActionSnapshot(input)
    expect(on).toEqual(off)
  })
})

const record = (
  start: number,
  total: number,
  trigger: CaptureTimingRecord['trigger'],
  shot: number
): CaptureTimingRecord => ({
  command: 'click',
  trigger,
  native: false,
  start,
  total,
  probes: [
    { probe: 'url', issued: 0, settled: 4, service: 4, empty: false },
    {
      probe: 'screenshot',
      issued: 0,
      settled: 4 + shot,
      service: shot,
      empty: false
    },
    {
      probe: 'process',
      issued: 4 + shot,
      settled: total,
      service: total - 4 - shot,
      empty: false
    }
  ]
})

const FIXTURE = [
  record(0, 110, 'action', 100),
  record(50, 210, 'action', 200),
  record(1000, 310, 'wait-poll', 300),
  record(2000, 1010, 'matcher-poll', 1000)
]

describe('summarizing', () => {
  it('reports count, total, median, p95 and max per probe, and the capture as a whole', () => {
    const summary = summarizeCaptureTiming(FIXTURE, 10_000)
    expect(summary.rows.find((r) => r.probe === 'screenshot')).toEqual({
      probe: 'screenshot',
      count: 4,
      total: 1616,
      median: 254,
      p95: 1004,
      max: 1004,
      serviceTotal: 1600,
      serviceMedian: 250
    })
    expect(summary.rows.map((r) => r.probe)).toEqual([
      'url',
      'screenshot',
      'process',
      'capture'
    ])
    expect(summary.rows.at(-1)).toMatchObject({ count: 4, total: 1640 })
    expect(summary.triggers).toEqual([
      { trigger: 'action', count: 2, total: 320 },
      { trigger: 'wait-poll', count: 1, total: 310 },
      { trigger: 'matcher-poll', count: 1, total: 1010 }
    ])
  })

  it('counts overlapping captures once toward the time spent capturing', () => {
    expect(summarizeCaptureTiming(FIXTURE).busy).toBe(260 + 310 + 1010)
  })

  it('is empty for no records', () => {
    expect(summarizeCaptureTiming([])).toEqual({
      captures: 0,
      native: 0,
      triggers: [],
      rows: [],
      busy: 0
    })
  })

  it('prints a table with the interpretation in its header', () => {
    const text = formatCaptureTimingSummary(
      summarizeCaptureTiming(FIXTURE, 10_000),
      '/out/capture-timing-1.ndjson'
    )
    expect(text).toBe(
      [
        '[devtools] capture timing: 4 captures (0 native; action 2, wait-poll 1, matcher-poll 1), busy 1.6 s of 10.0 s wall (15.8%)',
        "ms = issue to settle; the driver serves one request at a time, so svc (settle minus the previous probe's settle) is a probe's own cost and the rest is queueing",
        'probe (ms)  n  total  median   p95   max  svc total  svc median',
        'url         4     16       4     4     4         16           4',
        'screenshot  4   1616     254  1004  1004       1600         250',
        'process     4     24       6     6     6         24           6',
        'capture     4   1640     260  1010  1010       1640         260',
        'raw records: /out/capture-timing-1.ndjson'
      ].join('\n')
    )
  })
})

describe('reporting', () => {
  it('appends to one NDJSON file per process and starts afresh after each report', async () => {
    vi.stubEnv(CAPTURE_TIMING_ENV, '1')
    const capture = () =>
      captureActionSnapshot({
        command: 'click',
        takeScreenshot: () => Promise.resolve('AA')
      })
    await capture()
    const file = await reportCaptureTiming(outDir, (t) => drained.push(t))
    expect(file).toBe(path.join(outDir, captureTimingFileName(process.pid)))
    await capture()
    await capture()
    await reportCaptureTiming(outDir, (t) => drained.push(t))
    expect(fs.readFileSync(file!, 'utf8').trim().split('\n')).toHaveLength(3)
    expect(drained[0]).toContain('1 captures')
    expect(drained[1]).toContain('2 captures')
    expect(await reportCaptureTiming(outDir, () => undefined)).toBeUndefined()
  })

  it('still prints the summary when the file cannot be written', async () => {
    vi.stubEnv(CAPTURE_TIMING_ENV, '1')
    await captureActionSnapshot({
      command: 'click',
      takeScreenshot: () => Promise.resolve('AA')
    })
    const blocked = path.join(outDir, 'a-file')
    fs.writeFileSync(blocked, '')
    expect(
      await reportCaptureTiming(blocked, (t) => drained.push(t))
    ).toBeUndefined()
    expect(drained[0]).toContain('could not write')
    expect(drained[1]).toContain('1 captures')
  })
})
