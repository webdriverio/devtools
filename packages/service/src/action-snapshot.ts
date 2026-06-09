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
  return coreCapture({
    command,
    runScript: (src) => browser.execute(reviveScript(src)),
    takeScreenshot: () => browser.takeScreenshot().catch(() => undefined),
    getUrl: () => browser.getUrl().catch(() => undefined),
    getTitle: () => browser.getTitle().catch(() => undefined)
  })
}
