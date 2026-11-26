import logger from '@wdio/logger'
import { captureCallGuardFor, type CaptureCallGuard } from '@wdio/devtools-core'
import type { NightwatchBrowser } from './types.js'

const log = logger('@wdio/nightwatch-devtools:capture-calls')

/** This browser's capture-call guard, logging under the adapter's namespace. */
export function captureCallsFor(browser: NightwatchBrowser): CaptureCallGuard {
  return captureCallGuardFor(browser, (level, message) => log[level](message))
}
