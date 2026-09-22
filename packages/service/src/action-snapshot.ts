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
  upsertRichestSnapshot
} from '@wdio/devtools-core'
import { sessionHasDocument, type ActionSnapshot } from '@wdio/devtools-shared'
import { mobilePlatform } from './mobile.js'
import { directProbes } from './direct-probes.js'
import { wdioRunnerId } from './wdio-runner-id.js'

function reviveScript(src: string): () => unknown {
  // `src` from core/element-scripts is already a self-invoking IIFE
  // (`(function () { ... })()`); we just wrap it in a return so it's
  // a function browser.execute() can call.
  return new Function(`return (${src})`) as () => unknown
}

/** Bound on the end-of-test wait for a document the last action navigated to. */
const FINAL_SETTLE_TIMEOUT_MS = 8000
/** Time to let a paint land, so the final capture is not a transitional frame —
 *  measured on Appium, where a mid-paint screenshot runs 359-476 KB against a
 *  settled 1.87 MB. */
const FINAL_SETTLE_PAUSE_MS = 250

/**
 * Settle the page after the LAST action, before its capture. Every other
 * capture is taken in `beforeCommand`, at a moment the driver is idle and the
 * previous action's effect has had the test's own gap to land; the last action
 * has no successor, so this is the one place a settle earns its cost.
 *
 * `navigated` says the drain immediately before this brought a document the
 * session had not seen — the only condition under which `readyState` is worth
 * asking about. Ungated it is unreliable: right after a click the OUTGOING
 * document already reports 'complete', so a blind poll returns instantly and
 * captures the page the test just left. Gated, the document it describes is the
 * incoming one. Never throws.
 */
export async function settleAfterLastAction(
  browser: WebdriverIO.Browser,
  navigated: boolean,
  /** Appium context the session is in, so a hybrid app's webview takes the web
   *  path. Undefined for every non-Appium session, which has no contexts. */
  context?: string
): Promise<void> {
  // A test double or a driver without `pause`/`waitUntil` must not fail a
  // capture that has nothing to do with it, so the whole settle is best-effort.
  try {
    if (!sessionHasDocument(browser.capabilities, context)) {
      await browser.pause(FINAL_SETTLE_PAUSE_MS)
      return
    }
    // Not navigated: the app has been at rest since the last action, so the
    // test's own teardown is the gap that lets the paint land. Waiting costs
    // every test for nothing.
    if (!navigated) {
      return
    }
    // Caught separately from the outer handler: a slow load that blows the
    // timeout still leaves a page mid-paint, and that is exactly the frame the
    // pause exists to avoid capturing.
    await browser
      .waitUntil(
        async () =>
          (await browser
            .execute(() => document.readyState === 'complete')
            .catch(() => false)) === true,
        { timeout: FINAL_SETTLE_TIMEOUT_MS, interval: 150 }
      )
      .catch(() => undefined)
    await browser.pause(FINAL_SETTLE_PAUSE_MS)
  } catch {
    // The capture is worth taking regardless of why the settle could not run.
  }
}

/** Capture a DOM snapshot for a synthesized action row (e.g. an `expect.*`
 *  assertion) and push it stamped at the row's OWN timestamp — the trace
 *  player's Snapshot tab claims it by timestamp the same way it claims a
 *  command's own snapshot (see FrameSnapshotIndex.claimAfter). */
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
