/**
 * Opt-in timing of per-action trace captures, written by every adapter in one
 * format so a run from any of them can be compared with any other.
 */

/** Any value but empty, `0`, `false`, `no` or `off` times every per-action capture and reports where it went. */
export const CAPTURE_TIMING_ENV = 'DEVTOOLS_CAPTURE_TIMING'

/** NDJSON file the raw records are appended to, one per process, beside the trace output. */
export function captureTimingFileName(pid: number): string {
  return `capture-timing-${pid}.ndjson`
}

/** The Python adapter's reading of a `DEVTOOLS_*` switch, so both languages agree on what turns one on. */
export function isEnvFlagOn(value: string | undefined): boolean {
  return !['', '0', 'false', 'no', 'off'].includes(
    (value ?? '').trim().toLowerCase()
  )
}

/**
 * The reads a capture makes, in the order a capture issues them. `process` is
 * not a driver read: it is the in-process work that turns the reads into a
 * snapshot (page-source parsing and locator generation on native).
 */
export const CAPTURE_PROBES = [
  'url',
  'title',
  'pageSource',
  'accessibilityTree',
  'elements',
  'screenshot',
  'process'
] as const

export type CaptureProbe = (typeof CAPTURE_PROBES)[number]

/**
 * Why the capture ran. `wait-poll` is a capture taken for a command a wait
 * issued, `matcher-poll` one taken while an assertion matcher was polling,
 * `final` the capture of the last action's result.
 */
export const CAPTURE_TRIGGERS = [
  'action',
  'wait-poll',
  'matcher-poll',
  'final'
] as const

export type CaptureTrigger = (typeof CAPTURE_TRIGGERS)[number]

export interface CaptureProbeTiming {
  probe: CaptureProbe
  /** ms from the capture's start to the probe being issued. */
  issued: number
  /** ms from the capture's start to the probe settling. */
  settled: number
  /** `settled` minus the later of `issued` and the previous probe's `settled`: its own cost on a driver that serves one request at a time. */
  service: number
  /** No value came back: a refusal, a timeout or an empty read. */
  empty: boolean
}

/** One line of the NDJSON file. */
export interface CaptureTimingRecord {
  command: string
  trigger: CaptureTrigger
  native: boolean
  /** Epoch ms the capture started. */
  start: number
  /** ms from start to the snapshot being built. */
  total: number
  probes: CaptureProbeTiming[]
}
