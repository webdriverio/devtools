// Selenium adapter: wires SeleniumDriverLike into core's captureActionSnapshot.
// URL/title/screenshot/script are read through the UNPATCHED driver originals
// (getDriverOriginals) so the snapshot's own reads don't record as commands.
// getCurrentUrl/getTitle map to page.* actions, so capturing them would make
// every snapshot trigger another snapshot — a feedback loop that bloats the
// trace (observed: thousands of getUrl/getTitle actions in one run).

import { captureActionSnapshot as coreCapture } from '@wdio/devtools-core'
import type { ActionSnapshot } from '@wdio/devtools-shared'
import { getDriverOriginals } from './driverPatcher.js'
import type { SeleniumDriverLike } from './types.js'

export function captureActionSnapshot(
  driver: SeleniumDriverLike,
  command: string
): Promise<ActionSnapshot | null> {
  const orig = getDriverOriginals()
  return coreCapture({
    command,
    runScript: (src) =>
      orig.executeScript
        ? orig.executeScript(driver, `return (${src})`)
        : driver.executeScript(`return (${src})`),
    takeScreenshot: () =>
      orig.takeScreenshot
        ? orig.takeScreenshot(driver).catch(() => undefined)
        : Promise.resolve(undefined),
    getUrl: () =>
      orig.getCurrentUrl
        ? orig.getCurrentUrl(driver).catch(() => undefined)
        : Promise.resolve(undefined),
    getTitle: () =>
      orig.getTitle
        ? orig.getTitle(driver).catch(() => undefined)
        : Promise.resolve(undefined)
  })
}
