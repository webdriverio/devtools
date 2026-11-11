import fs from 'node:fs/promises'
import path from 'node:path'
import { performance } from 'node:perf_hooks'

import {
  CAPTURE_PROBES,
  CAPTURE_TIMING_ENV,
  CAPTURE_TRIGGERS,
  captureTimingFileName,
  isEnvFlagOn,
  type CaptureProbe,
  type CaptureProbeTiming,
  type CaptureTimingRecord,
  type CaptureTrigger
} from '@wdio/devtools-shared'
import { errorMessage } from './error.js'

/** Read per capture rather than cached, so a test or a long-lived process can flip it. */
export function captureTimingEnabled(): boolean {
  return isEnvFlagOn(process.env[CAPTURE_TIMING_ENV])
}

const pendingRecords: CaptureTimingRecord[] = []
let windowStart = performance.timeOrigin

const round = (ms: number) => Math.round(ms * 10) / 10

function isEmptyRead(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    value === '' ||
    (Array.isArray(value) && value.length === 0)
  )
}

interface OpenProbe {
  probe: CaptureProbe
  issued: number
  settled: number
  empty: boolean
}

/** Times the probes of one capture; built only while timing is on. */
export class CaptureTimer {
  readonly #start = Date.now()
  readonly #t0 = performance.now()
  readonly #probes: OpenProbe[] = []

  constructor(
    readonly command: string,
    readonly trigger: CaptureTrigger,
    readonly native: boolean
  ) {}

  #elapsed(): number {
    return performance.now() - this.#t0
  }

  /** Records `pending` without altering it; the probes never reject, so the side branch cannot either. */
  track<T>(probe: CaptureProbe, pending: Promise<T>): Promise<T> {
    const entry: OpenProbe = {
      probe,
      issued: this.#elapsed(),
      settled: Number.NaN,
      empty: true
    }
    this.#probes.push(entry)
    void pending.then((value) => {
      entry.settled = this.#elapsed()
      entry.empty = isEmptyRead(value)
    })
    return pending
  }

  /** Closes the capture; `processedFrom` is when the reads had all settled and in-process work began. */
  finish(processedFrom: number): void {
    const total = this.#elapsed()
    const probes: CaptureProbeTiming[] = []
    let previousSettled = 0
    for (const p of [
      ...this.#probes,
      {
        probe: 'process' as const,
        issued: processedFrom - this.#t0,
        settled: total,
        empty: false
      }
    ]) {
      const settled = Number.isNaN(p.settled) ? total : p.settled
      probes.push({
        probe: p.probe,
        issued: round(p.issued),
        settled: round(settled),
        service: round(
          Math.max(0, settled - Math.max(p.issued, previousSettled))
        ),
        empty: p.empty
      })
      previousSettled = settled
    }
    pendingRecords.push({
      command: this.command,
      trigger: this.trigger,
      native: this.native,
      start: this.#start,
      total: round(total),
      probes
    })
  }
}

/** A timer for one capture, or undefined (and nothing allocated) while timing is off. */
export function startCaptureTimer(
  command: string,
  trigger: CaptureTrigger,
  native: boolean
): CaptureTimer | undefined {
  return captureTimingEnabled()
    ? new CaptureTimer(command, trigger, native)
    : undefined
}

export interface CaptureStatRow {
  probe: CaptureProbe | 'capture'
  count: number
  total: number
  median: number
  p95: number
  max: number
  serviceTotal: number
  serviceMedian: number
}

export interface CaptureTimingSummary {
  captures: number
  native: number
  triggers: Array<{ trigger: CaptureTrigger; count: number; total: number }>
  rows: CaptureStatRow[]
  /** ms during which at least one capture was running; overlapping captures count once. */
  busy: number
  wall?: number
}

function sum(values: readonly number[]): number {
  return values.reduce((a, b) => a + b, 0)
}

function median(sorted: readonly number[]): number {
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/** Nearest-rank percentile, so every reported value is one that was measured. */
function percentile(sorted: readonly number[], p: number): number {
  return sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)]
}

function statRow(
  probe: CaptureStatRow['probe'],
  durations: number[],
  services: number[]
): CaptureStatRow {
  const sorted = [...durations].sort((a, b) => a - b)
  const svc = [...services].sort((a, b) => a - b)
  return {
    probe,
    count: sorted.length,
    total: round(sum(sorted)),
    median: round(median(sorted)),
    p95: round(percentile(sorted, 95)),
    max: round(sorted[sorted.length - 1]),
    serviceTotal: round(sum(svc)),
    serviceMedian: round(median(svc))
  }
}

function busyTime(records: readonly CaptureTimingRecord[]): number {
  const spans = records
    .map((r) => [r.start, r.start + r.total] as const)
    .sort((a, b) => a[0] - b[0])
  let busy = 0
  let end = Number.NEGATIVE_INFINITY
  for (const [from, to] of spans) {
    busy += Math.max(0, to - Math.max(from, end))
    end = Math.max(end, to)
  }
  return round(busy)
}

export function summarizeCaptureTiming(
  records: readonly CaptureTimingRecord[],
  wall?: number
): CaptureTimingSummary {
  const rows: CaptureStatRow[] = []
  for (const probe of CAPTURE_PROBES) {
    const timings = records.flatMap((r) =>
      r.probes.filter((p) => p.probe === probe)
    )
    if (timings.length) {
      rows.push(
        statRow(
          probe,
          timings.map((p) => p.settled - p.issued),
          timings.map((p) => p.service)
        )
      )
    }
  }
  if (records.length) {
    const totals = records.map((r) => r.total)
    rows.push(statRow('capture', totals, totals))
  }
  return {
    captures: records.length,
    native: records.filter((r) => r.native).length,
    triggers: CAPTURE_TRIGGERS.map((trigger) => {
      const of = records.filter((r) => r.trigger === trigger)
      return {
        trigger,
        count: of.length,
        total: round(sum(of.map((r) => r.total)))
      }
    }).filter((t) => t.count > 0),
    rows,
    busy: busyTime(records),
    ...(wall === undefined ? {} : { wall: round(wall) })
  }
}

const COLUMNS = [
  'n',
  'total',
  'median',
  'p95',
  'max',
  'svc total',
  'svc median'
]

// Rounded before formatting so a binary tie cannot round differently here and in the Python mirror.
const oneDecimal = (value: number) => (Math.round(value * 10) / 10).toFixed(1)
const seconds = (ms: number) => `${oneDecimal(ms / 1000)} s`

export function formatCaptureTimingSummary(
  summary: CaptureTimingSummary,
  file?: string
): string {
  const triggers = summary.triggers
    .map((t) => `${t.trigger} ${t.count}`)
    .join(', ')
  const share =
    summary.wall && summary.wall > 0
      ? ` of ${seconds(summary.wall)} wall (${oneDecimal((summary.busy / summary.wall) * 100)}%)`
      : ''
  const table = [
    ['probe (ms)', ...COLUMNS],
    ...summary.rows.map((r) => [
      r.probe,
      ...[
        r.count,
        r.total,
        r.median,
        r.p95,
        r.max,
        r.serviceTotal,
        r.serviceMedian
      ].map((v) => String(Math.round(v)))
    ])
  ]
  const widths = table[0].map((_, i) =>
    Math.max(...table.map((row) => row[i].length))
  )
  const lines = table.map((row) =>
    row
      .map((cell, i) =>
        i === 0 ? cell.padEnd(widths[i]) : cell.padStart(widths[i])
      )
      .join('  ')
  )
  return [
    `[devtools] capture timing: ${summary.captures} captures (${summary.native} native${triggers ? `; ${triggers}` : ''}), busy ${seconds(summary.busy)}${share}`,
    "ms = issue to settle; the driver serves one request at a time, so svc (settle minus the previous probe's settle) is a probe's own cost and the rest is queueing",
    ...lines,
    ...(file ? [`raw records: ${file}`] : [])
  ].join('\n')
}

/** Why the filmstrip poller let a tick pass without a screenshot. */
export type RecorderSkipReason = 'busy' | 'fresh' | 'inFlight'

const RECORDER_SKIP_LABELS: Record<RecorderSkipReason, string> = {
  busy: 'driver busy',
  fresh: 'fresh frame',
  inFlight: 'shot in flight'
}

/** Shot durations kept for the median; a live run is never reported, so the
 *  sample is a ring over the newest shots rather than every one. */
export const RECORDER_SHOT_SAMPLE_MAX = 2000

const recorderShots: number[] = []
let recorderShotCount = 0
let recorderShotTotal = 0
const recorderSkips: Record<RecorderSkipReason, number> = {
  busy: 0,
  fresh: 0,
  inFlight: 0
}
let recorderReused = 0

/** The filmstrip poller's own screenshot, `ms` from issue to settle. */
export function recordRecorderShot(ms: number): void {
  if (captureTimingEnabled()) {
    recorderShots[recorderShotCount % RECORDER_SHOT_SAMPLE_MAX] = ms
    recorderShotCount++
    recorderShotTotal += ms
  }
}

export function recordRecorderSkip(reason: RecorderSkipReason): void {
  if (captureTimingEnabled()) {
    recorderSkips[reason]++
  }
}

/** A per-action capture's screenshot kept as a filmstrip frame. */
export function recordRecorderReuse(): void {
  if (captureTimingEnabled()) {
    recorderReused++
  }
}

export interface RecorderTimingSummary {
  shots: number
  total: number
  median: number
  skipped: Record<RecorderSkipReason, number>
  reused: number
}

function hasRecorderActivity(): boolean {
  return (
    recorderShotCount > 0 ||
    recorderReused > 0 ||
    Object.values(recorderSkips).some((n) => n > 0)
  )
}

/** Drains the recorder counters gathered since the last report. */
function takeRecorderTiming(): RecorderTimingSummary {
  const sorted = recorderShots.splice(0).sort((a, b) => a - b)
  const shots = recorderShotCount
  const total = recorderShotTotal
  recorderShotCount = 0
  recorderShotTotal = 0
  const skipped = { ...recorderSkips }
  for (const reason of Object.keys(recorderSkips) as RecorderSkipReason[]) {
    recorderSkips[reason] = 0
  }
  const reused = recorderReused
  recorderReused = 0
  return {
    shots,
    total: round(total),
    median: sorted.length ? round(median(sorted)) : 0,
    skipped,
    reused
  }
}

export function formatRecorderTiming(summary: RecorderTimingSummary): string {
  const reasons = (Object.keys(summary.skipped) as RecorderSkipReason[])
    .filter((r) => summary.skipped[r] > 0)
    .map((r) => `${summary.skipped[r]} ${RECORDER_SKIP_LABELS[r]}`)
  const skippedTotal = sum(Object.values(summary.skipped))
  return (
    `[devtools] filmstrip recorder: ${summary.shots} screenshots, total ${seconds(summary.total)}, median ${Math.round(summary.median)} ms; ` +
    `${skippedTotal} ticks skipped${reasons.length ? ` (${reasons.join(', ')})` : ''}; ` +
    `${summary.reused} capture screenshots reused as frames`
  )
}

/** Appends the captures since the last report to the process's NDJSON file and prints their summary and the filmstrip recorder's line. Never throws. */
export async function reportCaptureTiming(
  outputDir: string,
  write: (text: string) => void = (text) => process.stderr.write(text)
): Promise<string | undefined> {
  const recorder = hasRecorderActivity() ? takeRecorderTiming() : undefined
  if (!pendingRecords.length) {
    if (recorder) {
      write(formatRecorderTiming(recorder) + '\n')
    }
    return undefined
  }
  const records = pendingRecords.splice(0)
  const now = Date.now()
  const wall = now - windowStart
  windowStart = now
  const file = path.join(outputDir, captureTimingFileName(process.pid))
  let written: string | undefined
  try {
    await fs.mkdir(outputDir, { recursive: true })
    await fs.appendFile(
      file,
      records.map((r) => JSON.stringify(r)).join('\n') + '\n'
    )
    written = file
  } catch (err) {
    write(`[devtools] could not write ${file}: ${errorMessage(err)}\n`)
  }
  write(
    formatCaptureTimingSummary(summarizeCaptureTiming(records, wall), written) +
      '\n'
  )
  if (recorder) {
    write(formatRecorderTiming(recorder) + '\n')
  }
  return written
}
