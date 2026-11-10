// Nightwatch adapter: wires NightwatchBrowser into core's captureActionSnapshot.
// Every probe goes over the raw WebDriver HTTP transport rather than `browser.*`:
// those are QUEUED commands, so a probe issued from inside the plugin's own
// command hook enqueues behind the command still running and can't resolve until
// the queue drains. `browser.getCurrentUrl()`/`getTitle()` that way left every
// snapshot with `url: undefined` (so `frameUrl` fell back to `about:blank`) and
// hung the capture outright; the queued `execute` merely timed out, leaving an
// empty a11y tree and no element rects.

import {
  captureActionSnapshot as coreCapture,
  type NativeApp
} from '@wdio/devtools-core'
import type { ActionSnapshot, CaptureTrigger } from '@wdio/devtools-shared'
import { webdriverExecute, webdriverGet } from './helpers/webdriverHttp.js'
import type { NightwatchBrowser, TestRunnerId } from './types.js'

export function captureActionSnapshot(
  browser: NightwatchBrowser,
  command: string,
  timestamp?: number,
  runner?: TestRunnerId,
  native?: NativeApp,
  trigger?: CaptureTrigger
): Promise<ActionSnapshot | null> {
  // A native app serves no page script, url or title; its page source is what
  // core builds the element list and accessibility tree from.
  return coreCapture({
    command,
    timestamp,
    runner,
    trigger,
    takeScreenshot: () => webdriverGet<string>(browser, 'screenshot'),
    ...(native
      ? {
          getPageSource: () => webdriverGet<string>(browser, 'source'),
          platform: native.platform
        }
      : {
          runScript: (src: string) =>
            webdriverExecute(browser, `return (${src})`),
          getUrl: () => webdriverGet<string>(browser, 'url'),
          getTitle: () => webdriverGet<string>(browser, 'title')
        })
  })
}
