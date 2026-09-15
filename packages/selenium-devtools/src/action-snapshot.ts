// Selenium adapter: wires SeleniumDriverLike into core's captureActionSnapshot.
// URL/title/screenshot/script are read through the UNPATCHED driver originals
// (getDriverOriginals) so the snapshot's own reads don't record as commands.
// getCurrentUrl/getTitle map to page.* actions, so capturing them would make
// every snapshot trigger another snapshot — a feedback loop that bloats the
// trace (observed: thousands of getUrl/getTitle actions in one run).

import { captureActionSnapshot as coreCapture } from '@wdio/devtools-core'
import type { ActionSnapshot } from '@wdio/devtools-shared'
import { SELENIUM_RUNNER_ID } from './constants.js'
import { getDriverOriginals } from './driverPatcher.js'
import type { SeleniumDriverLike } from './types.js'

export function captureActionSnapshot(
  driver: SeleniumDriverLike,
  command: string,
  timestamp?: number,
  native = false
): Promise<ActionSnapshot | null> {
  const orig = getDriverOriginals()
  // The screenshot is the only one of these a native app can serve. The other
  // three are page reads — two injected scripts plus url and title — and they
  // fire on EVERY action, so they are the densest source of round trips that
  // can only fail on a session with no document.
  return coreCapture({
    command,
    timestamp,
    runner: SELENIUM_RUNNER_ID,
    takeScreenshot: () =>
      orig.takeScreenshot
        ? orig.takeScreenshot(driver).catch(() => undefined)
        : Promise.resolve(undefined),
    ...(native
      ? {}
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
