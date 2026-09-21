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
  mapCommandToAction,
  upsertRichestSnapshot
} from '@wdio/devtools-core'
import { sessionHasDocument, type ActionSnapshot } from '@wdio/devtools-shared'
import { mobilePlatform } from './mobile.js'
import { directProbes } from './direct-probes.js'
import { INTERNAL_COMMANDS } from './constants.js'
import { wdioRunnerId } from './wdio-runner-id.js'

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
  stampTimestamp: () => number,
  /** Appium context the session is in, so a hybrid app's webview takes the web
   *  path. Undefined for every non-Appium session, which has no contexts. */
  context?: string
): Promise<void> {
  if (!mapCommandToAction(command) || INTERNAL_COMMANDS.includes(command)) {
    return
  }
  // Keyed on having a document, matching `#markDocument`, which writes the tag
  // this reads — split, a session tags a document nothing settles on.
  if (sessionHasDocument(browser.capabilities, context)) {
    await waitForActionResult(browser)
  }
  // Stamped before the capture, not after: a snapshot probe can never enter
  // commandsLog (beforeCommand requires an empty command stack), so the latest
  // logged action is the same either way — and reading it up front keeps the
  // stamp a capture input rather than a post-hoc mutation.
  const snap = await captureActionSnapshot(
    browser,
    command,
    stampTimestamp(),
    context
  )
  if (snap) {
    upsertRichestSnapshot(actionSnapshots, snap)
  }
}

/** Capture a DOM snapshot for a synthesized action row (e.g. an `expect.*`
 *  assertion) and push it stamped at the row's OWN timestamp — the trace
 *  player's Snapshot tab claims it by timestamp the same way it claims a
 *  regular command's post-action snapshot (see FrameSnapshotIndex.claimAfter).
 *  Mirrors the tail of `captureActionResult` for a command with no page-settle. */
export async function pushActionSnapshotAt(
  browser: WebdriverIO.Browser,
  command: string,
  timestamp: number,
  actionSnapshots: ActionSnapshot[],
  context?: string
): Promise<void> {
  const snap = await captureActionSnapshot(browser, command, timestamp, context)
  if (snap) {
    upsertRichestSnapshot(actionSnapshots, snap)
  }
}

export function captureActionSnapshot(
  browser: WebdriverIO.Browser,
  command: string,
  timestamp?: number,
  context?: string
): Promise<ActionSnapshot | null> {
  // A mobile BROWSER session takes the web path below: it has a document, and
  // the native path would read its HTML through the page-source XML parser. So
  // does a hybrid app while it sits in a webview context — its DOM is real, and
  // reading it as page-source XML loses the whole replay.
  const native = !sessionHasDocument(browser.capabilities, context)
  // A driver that serialises per session deadlocks on a probe issued from
  // inside the command hook, so those go straight to it (#374).
  const direct = directProbes(browser)
  return coreCapture({
    command,
    timestamp,
    runner: wdioRunnerId(browser),
    runScript: native
      ? undefined
      : direct
        ? // an element-script src is a self-invoking IIFE, and `execute/sync`
          // takes a function body — the string form of `reviveScript`.
          (src: string) => direct.runScript(`return (${src})`)
        : (src: string) => browser.execute(reviveScript(src)),
    takeScreenshot:
      direct?.takeScreenshot ??
      (() => browser.takeScreenshot().catch(() => undefined)),
    // url/title are browser-only concepts — they fail with "Method has not
    // yet been implemented" on native mobile, costing a round-trip each.
    getUrl: native
      ? undefined
      : (direct?.getUrl ?? (() => browser.getUrl().catch(() => undefined))),
    getTitle: native
      ? undefined
      : (direct?.getTitle ?? (() => browser.getTitle().catch(() => undefined))),
    // On native mobile, use page-source XML to produce structured element
    // data and an AI-readable snapshot (same approach as @wdio/elements).
    getPageSource: native
      ? (direct?.getPageSource ??
        (() => browser.getPageSource().catch(() => undefined)))
      : undefined,
    platform: native ? mobilePlatform(browser) : undefined
  })
}
