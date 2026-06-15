// Nightwatch adapter: wires NightwatchBrowser into core's captureActionSnapshot.

import { captureActionSnapshot as coreCapture } from '@wdio/devtools-core'
import type { ActionSnapshot } from '@wdio/devtools-shared'
import type { NightwatchBrowser } from './types.js'

interface BrowserWithUrl extends NightwatchBrowser {
  getCurrentUrl?: () => Promise<string>
  getTitle?: () => Promise<string>
}

export function captureActionSnapshot(
  browser: NightwatchBrowser,
  command: string,
  takeScreenshot?: () => Promise<string | null | undefined>
): Promise<ActionSnapshot | null> {
  const b = browser as BrowserWithUrl
  return coreCapture({
    command,
    runScript: (src) => browser.execute(`return (${src})`) as Promise<unknown>,
    takeScreenshot,
    getUrl: () =>
      b.getCurrentUrl
        ? b.getCurrentUrl().catch(() => undefined)
        : Promise.resolve(undefined),
    getTitle: () =>
      b.getTitle
        ? b.getTitle().catch(() => undefined)
        : Promise.resolve(undefined)
  })
}
