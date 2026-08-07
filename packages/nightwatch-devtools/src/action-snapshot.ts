// Nightwatch adapter: wires NightwatchBrowser into core's captureActionSnapshot.
// Every probe goes over the raw WebDriver HTTP transport rather than `browser.*`:
// those are QUEUED commands, so a probe issued from inside the plugin's own
// command hook enqueues behind the command still running and can't resolve until
// the queue drains. `browser.getCurrentUrl()`/`getTitle()` that way left every
// snapshot with `url: undefined` (so `frameUrl` fell back to `about:blank`) and
// hung the capture outright; the queued `execute` merely timed out, leaving an
// empty a11y tree and no element rects.

import { captureActionSnapshot as coreCapture } from '@wdio/devtools-core'
import type { ActionSnapshot } from '@wdio/devtools-shared'
import { webdriverExecute, webdriverGet } from './helpers/webdriverHttp.js'
import type { NightwatchBrowser, TestRunnerId } from './types.js'

export function captureActionSnapshot(
  browser: NightwatchBrowser,
  command: string,
  timestamp?: number,
  runner?: TestRunnerId
): Promise<ActionSnapshot | null> {
  return coreCapture({
    command,
    timestamp,
    runner,
    runScript: (src) => webdriverExecute(browser, `return (${src})`),
    takeScreenshot: () => webdriverGet<string>(browser, 'screenshot'),
    // `?? undefined`: the transport answers `null` on a failed read, which core's
    // url/title probes type as `undefined` (only `takeScreenshot` accepts null).
    getUrl: () =>
      webdriverGet<string>(browser, 'url').then((v) => v ?? undefined),
    getTitle: () =>
      webdriverGet<string>(browser, 'title').then((v) => v ?? undefined)
  })
}
