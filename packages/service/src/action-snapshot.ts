// WDIO adapter: wires WebdriverIO.Browser into core's captureActionSnapshot.
// `browser.execute` is passed a Function reconstructed from the script body
// string (the same trick @wdio/elements uses); a raw string would route
// through a different WDIO path that doesn't preserve the script closure.
//
// `src` is NOT user-controlled: it's one of two compile-time constants
// produced by `@wdio/devtools-core/element-scripts` and shipped with the
// library. No external input reaches new Function() — the lint flag here is
// a false positive given the closed input set.

import { captureActionSnapshot as coreCapture } from '@wdio/devtools-core'
import type { ActionSnapshot } from '@wdio/devtools-shared'

function reviveScript(src: string): () => unknown {
  // `src` from core/element-scripts is already a self-invoking IIFE
  // (`(function () { ... })()`); we just wrap it in a return so it's
  // a function browser.execute() can call.
  return new Function(`return (${src})`) as () => unknown
}

export function captureActionSnapshot(
  browser: WebdriverIO.Browser,
  command: string
): Promise<ActionSnapshot | null> {
  // Element scripts don't work on native mobile — Appium can't execute
  // JavaScript in a native app context. Skip to avoid 2× 2500ms timeouts.
  const isNativeMobile = Boolean(
    (browser as unknown as Record<string, unknown>).isMobile ||
    (browser as unknown as Record<string, unknown>).isAndroid ||
    (browser as unknown as Record<string, unknown>).isIOS
  )
  return coreCapture({
    command,
    runScript: isNativeMobile
      ? undefined
      : (src) => browser.execute(reviveScript(src)),
    takeScreenshot: () => browser.takeScreenshot().catch(() => undefined),
    // url/title are browser-only concepts — they fail with "Method has not
    // yet been implemented" on native mobile, costing a round-trip each.
    getUrl: isNativeMobile
      ? undefined
      : () => browser.getUrl().catch(() => undefined),
    getTitle: isNativeMobile
      ? undefined
      : () => browser.getTitle().catch(() => undefined)
  })
}
