// Ceilings on capture calls, applied only on Chrome 156/157, which never answer BiDi for a window.open() tab (crbug 571161446).

import { isNativePlatform } from '@wdio/devtools-shared'
import {
  SNAPSHOT_DRIVER_PROBE_TIMEOUT_MS,
  withTimeout
} from './with-timeout.js'

/** Ceiling for BiDi setup; above the 6.2 s a network subscribe was measured taking on a healthy session. */
export const BIDI_SETUP_TIMEOUT_MS = 10_000

/** Chrome majors whose BiDi implementation never answers for a popup tab. */
export const POPUP_BIDI_HANG_CHROME_MAJORS: readonly number[] = [156, 157]

/** The first Chrome release carrying the fix. */
export const POPUP_BIDI_HANG_FIXED_IN = '158.0.8106.0'

/** What a guarded call resolves to when its fallback must say it was cut off rather than answered. */
export const CAPTURE_CALL_TIMED_OUT: unique symbol = Symbol(
  'capture-call-timed-out'
)

const CHROME_BROWSER_NAMES = new Set([
  'chrome',
  'chromium',
  'chrome-headless-shell'
])

interface BrowserCapabilities {
  browserName?: unknown
  browserVersion?: unknown
  version?: unknown
  platformName?: unknown
}

/** The Chrome major a session runs, or undefined for any other browser or an unreadable version. */
export function chromeMajorVersion(capabilities: unknown): number | undefined {
  if (!capabilities || typeof capabilities !== 'object') {
    return undefined
  }
  const caps = capabilities as BrowserCapabilities
  const name = String(caps.browserName ?? '').toLowerCase()
  if (!CHROME_BROWSER_NAMES.has(name)) {
    return undefined
  }
  const match = /^(\d+)\./.exec(
    String(caps.browserVersion ?? caps.version ?? '')
  )
  return match ? Number(match[1]) : undefined
}

/** Whether the session runs a Chrome that leaves BiDi commands to a popup tab unanswered. */
export function hasPopupBidiHang(capabilities: unknown): boolean {
  const major = chromeMajorVersion(capabilities)
  return major !== undefined && POPUP_BIDI_HANG_CHROME_MAJORS.includes(major)
}

function isAppiumCapabilities(capabilities: object): boolean {
  const platform = String(
    (capabilities as BrowserCapabilities).platformName ?? ''
  ).toLowerCase()
  return (
    isNativePlatform(platform) ||
    Object.keys(capabilities).some((key) => key.startsWith('appium:'))
  )
}

/** Whether capture calls get ceilings: Chrome 156/157 on a desktop session, never an Appium one, whose calls are legitimately slow. */
export function captureCeilingsApply(capabilities: unknown): boolean {
  return (
    hasPopupBidiHang(capabilities) &&
    !isAppiumCapabilities(capabilities as object)
  )
}

/** What capture does after a call is cut off, worded for the warning. */
export const CAPTURE_TIMEOUT_CONSEQUENCE = {
  keepTrying: 'Capture keeps trying, each call up to its ceiling',
  setupFallback:
    "This session falls back to per-document injection and the page's own console and network"
} as const

/** The warning for a capture call cut off on an affected Chrome; it does not claim the popup bug was the cause. */
export function popupBidiHangWarning(
  what: string,
  major: number,
  consequence: string
): string {
  return (
    `DevTools capture: ${what} timed out on Chrome ${major}, which hangs WebDriver ` +
    'BiDi commands to tabs opened by window.open() (crbug 571161446, fixed in ' +
    `Chrome ${POPUP_BIDI_HANG_FIXED_IN}). ${consequence}; run popup flows on ` +
    'Chrome 155 or 158+.'
  )
}

/** The session a capture call ran against. */
export interface CaptureSession {
  sessionId?: string | null
  capabilities?: unknown
}

export type CaptureCallLog = (level: 'info' | 'warn', message: string) => void

/** Handed to a call that runs without a ceiling. */
export const NEVER_ABORTED: AbortSignal = new AbortController().signal

/** Ceilings capture calls on Chrome 156/157 off Appium, warning once per session; every other session runs them as is. */
export class CaptureCallGuard {
  readonly #session: () => CaptureSession | undefined
  readonly #log: CaptureCallLog
  readonly #warned = new Set<string>()

  constructor(session: () => CaptureSession | undefined, log: CaptureCallLog) {
    this.#session = session
    this.#log = log
  }

  /** Whether the current session gets ceilings at all. */
  get applies(): boolean {
    return captureCeilingsApply(this.#session()?.capabilities)
  }

  /** `call`'s value, or `fallback` once `ms` pass with its signal aborted; on an unaffected session, `call` as is. */
  run<T>(
    call: (signal: AbortSignal) => Promise<T>,
    ms: number,
    fallback: T,
    what: string
  ): Promise<T> {
    return this.#ceil(
      call,
      ms,
      fallback,
      what,
      CAPTURE_TIMEOUT_CONSEQUENCE.keepTrying
    )
  }

  /** A driver read under the driver-probe ceiling, undefined when cut off. */
  read<T>(call: () => Promise<T>, what: string): Promise<T | undefined> {
    return this.run<T | undefined>(
      call,
      SNAPSHOT_DRIVER_PROBE_TIMEOUT_MS,
      undefined,
      what
    )
  }

  /** A setup call (preload, subscriptions): the same ceiling, warned as the session's fallback. */
  setup<T>(
    call: (signal: AbortSignal) => Promise<T>,
    ms: number,
    fallback: T,
    what: string
  ): Promise<T> {
    return this.#ceil(
      call,
      ms,
      fallback,
      what,
      CAPTURE_TIMEOUT_CONSEQUENCE.setupFallback
    )
  }

  /** Report a call that some other ceiling cut off; a no-op on an unaffected session. */
  timedOut(what: string): void {
    if (this.applies) {
      this.#warnOnce(what, CAPTURE_TIMEOUT_CONSEQUENCE.keepTrying)
    }
  }

  #ceil<T>(
    call: (signal: AbortSignal) => Promise<T>,
    ms: number,
    fallback: T,
    what: string,
    consequence: string
  ): Promise<T> {
    if (!this.applies) {
      return call(NEVER_ABORTED)
    }
    const controller = new AbortController()
    return withTimeout(call(controller.signal), ms, fallback, () => {
      controller.abort()
      this.#warnOnce(what, consequence)
    })
  }

  #warnOnce(what: string, consequence: string): void {
    const session = this.#session()
    const key = String(session?.sessionId ?? '')
    if (this.#warned.has(key)) {
      return
    }
    this.#warned.add(key)
    const major = chromeMajorVersion(session?.capabilities) ?? 0
    this.#log('warn', popupBidiHangWarning(what, major, consequence))
  }
}

const guardsByBrowser = new WeakMap<object, CaptureCallGuard>()

/** One guard per browser object, reading its session live, so a session replaced in place warns again. */
export function captureCallGuardFor(
  browser: CaptureSession & object,
  log: CaptureCallLog
): CaptureCallGuard {
  let guard = guardsByBrowser.get(browser)
  if (!guard) {
    guard = new CaptureCallGuard(() => browser, log)
    guardsByBrowser.set(browser, guard)
  }
  return guard
}
