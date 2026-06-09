// Selenium adapter: wires SeleniumDriverLike into core's captureActionSnapshot.

import { captureActionSnapshot as coreCapture } from '@wdio/devtools-core'
import type { ActionSnapshot } from '@wdio/devtools-shared'
import type { SeleniumDriverLike } from './types.js'

interface DriverWithUrl extends SeleniumDriverLike {
  getCurrentUrl?: () => Promise<string>
  getTitle?: () => Promise<string>
}

export function captureActionSnapshot(
  driver: SeleniumDriverLike,
  command: string
): Promise<ActionSnapshot | null> {
  const d = driver as DriverWithUrl
  return coreCapture({
    command,
    runScript: (src) => driver.executeScript(`return (${src})`),
    takeScreenshot: () =>
      d.takeScreenshot
        ? d.takeScreenshot().catch(() => undefined)
        : Promise.resolve(undefined),
    getUrl: () =>
      d.getCurrentUrl
        ? d.getCurrentUrl().catch(() => undefined)
        : Promise.resolve(undefined),
    getTitle: () =>
      d.getTitle
        ? d.getTitle().catch(() => undefined)
        : Promise.resolve(undefined)
  })
}
