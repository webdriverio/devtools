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
  runner?: TestRunnerId,
  native = false
): Promise<ActionSnapshot | null> {
  // The screenshot is the only one of these a native app can serve. The rest
  // are page reads — an injected script plus url and title — and they fire on
  // EVERY action, so they are the densest source of round trips that can only
  // fail on a session with no document.
  return coreCapture({
    command,
    timestamp,
    runner,
    takeScreenshot: () => webdriverGet<string>(browser, 'screenshot'),
    ...(native
      ? {}
      : {
          runScript: (src: string) =>
            webdriverExecute(browser, `return (${src})`),
          getUrl: () => webdriverGet<string>(browser, 'url'),
          getTitle: () => webdriverGet<string>(browser, 'title')
        })
  })
}
