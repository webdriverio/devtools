// Selenium adapter: wires SeleniumDriverLike into core's captureActionSnapshot.
// URL/title/screenshot/script/page source are read through the UNPATCHED driver
// originals (getDriverOriginals) so the snapshot's own reads don't record as
// commands.
// getCurrentUrl/getTitle map to page.* actions, so capturing them would make
// every snapshot trigger another snapshot — a feedback loop that bloats the
// trace (observed: thousands of getUrl/getTitle actions in one run).

import {
  captureActionSnapshot as coreCapture,
  type NativeApp
} from '@wdio/devtools-core'
import type { ActionSnapshot, CaptureTrigger } from '@wdio/devtools-shared'
import { SELENIUM_RUNNER_ID } from './constants.js'
import { getDriverOriginals } from './driverPatcher.js'
import type { SeleniumDriverLike } from './types.js'

export function captureActionSnapshot(
  driver: SeleniumDriverLike,
  command: string,
  timestamp?: number,
  native?: NativeApp,
  trigger?: CaptureTrigger
): Promise<ActionSnapshot | null> {
  const orig = getDriverOriginals()
  // A native app serves no page script, url or title; its page source is what
  // core builds the element list and accessibility tree from.
  return coreCapture({
    command,
    timestamp,
    trigger,
    runner: SELENIUM_RUNNER_ID,
    takeScreenshot: () =>
      orig.takeScreenshot
        ? orig.takeScreenshot(driver).catch(() => undefined)
        : Promise.resolve(undefined),
    ...(native
      ? {
          getPageSource: () =>
            orig.getPageSource
              ? orig.getPageSource(driver).catch(() => undefined)
              : Promise.resolve(undefined),
          platform: native.platform
        }
      : {
          runScript: (src: string) =>
            orig.executeScript
              ? orig.executeScript(driver, `return (${src})`)
              : driver.executeScript(`return (${src})`),
          getUrl: () =>
            orig.getCurrentUrl
              ? orig.getCurrentUrl(driver).catch(() => undefined)
              : Promise.resolve(undefined),
          getTitle: () =>
            orig.getTitle
              ? orig.getTitle(driver).catch(() => undefined)
              : Promise.resolve(undefined)
        })
  })
}
