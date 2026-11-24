import logger from '@wdio/logger'
import {
  BIDI_SETUP_TIMEOUT_MS,
  CAPTURE_CALL_TIMED_OUT,
  CAPTURE_PERFORMANCE_SCRIPT,
  captureCallGuardFor,
  SNAPSHOT_PROBE_TIMEOUT_MS,
  WEBDRIVER_REQUEST_TIMEOUT_MS,
  type CaptureCallGuard,
  type CapturedPerformancePayload
} from '@wdio/devtools-core'

const log = logger('@wdio/devtools-service:capture-calls')

/** This browser's capture-call guard, logging under the service's namespace. */
export function captureCallsFor(
  browser: WebdriverIO.Browser
): CaptureCallGuard {
  return captureCallGuardFor(browser, (level, message) => log[level](message))
}

/** A screenshot, or undefined when cut off. */
export function screenshotWithin(
  browser: WebdriverIO.Browser,
  what: string
): Promise<string | undefined> {
  return captureCallsFor(browser).read(() => browser.takeScreenshot(), what)
}

/** A driver read such as the url, or undefined when cut off. */
export function readWithin<T>(
  browser: WebdriverIO.Browser,
  read: () => Promise<T>,
  what: string
): Promise<T | undefined> {
  return captureCallsFor(browser).read(read, what)
}

/** The page's navigation timings, or undefined when cut off. */
export function readPerformanceWithin(
  browser: WebdriverIO.Browser
): Promise<CapturedPerformancePayload | undefined> {
  return readWithin(
    browser,
    () =>
      browser.execute(CAPTURE_PERFORMANCE_SCRIPT) as Promise<
        CapturedPerformancePayload | undefined
      >,
    'performance read'
  )
}

/** One poll of an in-page script, or `fallback` when cut off. */
export function pollWithin<T>(
  browser: WebdriverIO.Browser,
  poll: () => Promise<T>,
  fallback: T,
  what: string
): Promise<T> {
  return captureCallsFor(browser).run(
    poll,
    SNAPSHOT_PROBE_TIMEOUT_MS,
    fallback,
    what
  )
}

/** A collector drain, or `CAPTURE_CALL_TIMED_OUT` when cut off, so recovery is not attempted. */
export function drainWithin(
  browser: WebdriverIO.Browser,
  drain: () => Promise<unknown>
): Promise<unknown> {
  return captureCallsFor(browser).run<unknown>(
    drain,
    WEBDRIVER_REQUEST_TIMEOUT_MS,
    CAPTURE_CALL_TIMED_OUT,
    'collector drain'
  )
}

/** Evaluate the collector into the current document, unless cut off. */
export function injectWithin(
  browser: WebdriverIO.Browser,
  source: string
): Promise<unknown> {
  return captureCallsFor(browser).run<unknown>(
    () => browser.execute(`return ${source}`),
    WEBDRIVER_REQUEST_TIMEOUT_MS,
    undefined,
    'collector injection'
  )
}

/** Register the document-start preload; false when it was cut off. */
export function registerPreloadWithin(
  browser: WebdriverIO.Browser,
  functionDeclaration: string
): Promise<boolean> {
  return captureCallsFor(browser).setup(
    async (signal) => {
      const added = await browser.scriptAddPreloadScript({
        functionDeclaration
      })
      // Answered after its ceiling, when capture has already fallen back to injection.
      if (signal.aborted) {
        if (added?.script) {
          await browser
            .scriptRemovePreloadScript({ script: added.script })
            .catch(() => {})
        }
        return false
      }
      return true
    },
    BIDI_SETUP_TIMEOUT_MS,
    false,
    'BiDi preload registration'
  )
}
