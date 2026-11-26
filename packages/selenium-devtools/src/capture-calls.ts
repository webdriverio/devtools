import {
  CAPTURE_CALL_TIMED_OUT,
  WEBDRIVER_REQUEST_TIMEOUT_MS,
  type CaptureCallGuard
} from '@wdio/devtools-core'
import { getDriverOriginals } from './driverPatcher.js'
import type { SeleniumDriverLike } from './types.js'

export type PageScript = (
  script: string,
  ...args: unknown[]
) => Promise<unknown>

/** The driver's unpatched `executeScript` under the guard; `CAPTURE_CALL_TIMED_OUT` when cut off. */
export function pageScript(
  guard: CaptureCallGuard,
  driver: SeleniumDriverLike | undefined,
  what: string
): PageScript | undefined {
  const exec = getDriverOriginals().executeScript
  if (!driver || !exec) {
    return undefined
  }
  return (script, ...args) =>
    guard.run(
      () => exec(driver, script, ...args),
      WEBDRIVER_REQUEST_TIMEOUT_MS,
      CAPTURE_CALL_TIMED_OUT,
      what
    )
}
