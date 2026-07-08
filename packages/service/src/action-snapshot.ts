// WDIO adapter: wires WebdriverIO.Browser into core's captureActionSnapshot.
// `browser.execute` is passed a Function reconstructed from the script body
// string (the same trick @wdio/elements uses); a raw string would route
// through a different WDIO path that doesn't preserve the script closure.
//
// `src` is NOT user-controlled: it's one of two compile-time constants
// produced by `@wdio/devtools-core/element-scripts` and shipped with the
// library. No external input reaches new Function() — the lint flag here is
// a false positive given the closed input set.

import {
  captureActionSnapshot as coreCapture,
  mapCommandToAction
} from '@wdio/devtools-core'
import type { ActionSnapshot } from '@wdio/devtools-shared'
import { isNativeMobile, mobilePlatform } from './mobile.js'
import { INTERNAL_COMMANDS } from './constants.js'

function reviveScript(src: string): () => unknown {
  // `src` from core/element-scripts is already a self-invoking IIFE
  // (`(function () { ... })()`); we just wrap it in a return so it's
  // a function browser.execute() can call.
  return new Function(`return (${src})`) as () => unknown
}

/**
 * After a mapped action, wait for the resulting page to settle before the
 * post-action screenshot. readyState alone is unreliable — right after a click
 * the OLD document still reports 'complete'. beforeCommand tags the document;
 * if the tag is gone the action navigated, so we wait for the NEW document to
 * finish loading AND render content before the destination is screenshotted.
 */
export async function waitForActionResult(
  browser: WebdriverIO.Browser
): Promise<void> {
  const navigated = await browser
    .execute(
      () => !(window as Window & { __wdioSnapMark?: boolean }).__wdioSnapMark
    )
    .catch(() => true)
  if (!navigated) {
    return
  }
  await browser
    .waitUntil(
      async () =>
        (await browser
          .execute(
            () =>
              document.readyState === 'complete' &&
              !!document.body &&
              document.body.childElementCount > 0
          )
          .catch(() => false)) === true,
      { timeout: 8000, interval: 150 }
    )
    .catch(() => undefined)
  // Headless renderers can return a blank shot right after load; let it paint.
  await browser.pause(250).catch(() => undefined)
}

/** Post-action capture: settle the resulting page, screenshot it, and push the
 *  snapshot stamped at the latest logged action. No-op for internal/non-mapped
 *  commands. Skipped by the caller outside trace mode. */
export async function captureActionResult(
  browser: WebdriverIO.Browser,
  command: string,
  actionSnapshots: ActionSnapshot[],
  stampTimestamp: () => number
): Promise<void> {
  if (!mapCommandToAction(command) || INTERNAL_COMMANDS.includes(command)) {
    return
  }
  if (!isNativeMobile(browser)) {
    await waitForActionResult(browser)
  }
  const snap = await captureActionSnapshot(browser, command)
  if (snap) {
    snap.timestamp = stampTimestamp()
    actionSnapshots.push(snap)
  }
}

export function captureActionSnapshot(
  browser: WebdriverIO.Browser,
  command: string
): Promise<ActionSnapshot | null> {
  const native = isNativeMobile(browser)
  return coreCapture({
    command,
    runScript: native ? undefined : (src) => browser.execute(reviveScript(src)),
    takeScreenshot: () => browser.takeScreenshot().catch(() => undefined),
    // url/title are browser-only concepts — they fail with "Method has not
    // yet been implemented" on native mobile, costing a round-trip each.
    getUrl: native ? undefined : () => browser.getUrl().catch(() => undefined),
    getTitle: native
      ? undefined
      : () => browser.getTitle().catch(() => undefined),
    // On native mobile, use page-source XML to produce structured element
    // data and an AI-readable snapshot (same approach as @wdio/elements).
    getPageSource: native
      ? () => browser.getPageSource().catch(() => undefined)
      : undefined,
    platform: native ? mobilePlatform(browser) : undefined
  })
}
