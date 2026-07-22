import logger from '@wdio/logger'
import {
  CAPTURE_PERFORMANCE_SCRIPT,
  applyPerformanceData,
  errorMessage,
  mapCommandToAction,
  toError,
  type CapturedPerformancePayload,
  type RetryTracker
} from '@wdio/devtools-core'
import { getDriverOriginals, getElementOriginals } from '../driverPatcher.js'
import { captureOrReplaceCommand } from './captureOrReplaceCommand.js'
import { captureActionSnapshot } from '../action-snapshot.js'
import type { SessionCapturer } from '../session.js'
import type { TestManager } from './testManager.js'
import type {
  ActionSnapshot,
  CapturedCommand,
  CommandLog,
  DevToolsMode,
  SeleniumDriverLike
} from '../types.js'

const log = logger('@wdio/selenium-devtools:commandPostActions')

/** Element commands that edit the current document (field values, form state).
 *  After these we drain the collector so the edits land in the mutation stream
 *  before a navigation (e.g. a submit click) discards the page. */
const DOM_MUTATING_ELEMENT_COMMANDS = new Set([
  'click',
  'sendKeys',
  'clear',
  'submit'
])

/**
 * Helpers that run AFTER an `onCommand` capture/replace has fired. Kept out
 * of the plugin class so the hot path stays readable and these are easier to
 * test in isolation.
 */

/**
 * For `findElement` / `findElements` commands, replace the opaque WebElement
 * result with a "<tag>\"text\"" preview the UI can render. Uses the
 * unwrapped element methods so the probes don't appear as phantom commands.
 */
export async function enrichFindResult(
  capturer: SessionCapturer,
  rawResult: unknown,
  entry: CommandLog,
  ts: number
): Promise<void> {
  const els = getElementOriginals()
  const getTagName = els.getTagName
  const getText = els.getText
  if (!getTagName || !getText) {
    return
  }
  try {
    const elements = Array.isArray(rawResult) ? rawResult : [rawResult]
    const previews = await Promise.all(
      elements.slice(0, 5).map(async (el: unknown) => {
        const tag = await getTagName(el).catch(() => 'element')
        const text = await getText(el).catch(() => '')
        const trimmed = text.length > 60 ? text.slice(0, 60) + '…' : text
        return trimmed ? `<${tag}>"${trimmed}"` : `<${tag}>`
      })
    )
    const more = elements.length > 5 ? `, +${elements.length - 5} more` : ''
    const enriched = Array.isArray(rawResult)
      ? `[${previews.join(', ')}${more}]`
      : previews[0]
    entry.result = enriched
    capturer.sendReplaceCommand(ts, entry)
  } catch {
    // Element detached / stale — leave the original `<WebElement>` text.
  }
}

/**
 * On navigation commands, inject the page-side capture script (once per
 * session), capture Performance API data onto the command entry, and pull
 * the latest trace + browser logs. Fire-and-forget; errors are logged unless
 * the session has already finalized (post-quit errors are expected and
 * uninteresting).
 *
 * When `entry` is provided, the shared `CAPTURE_PERFORMANCE_SCRIPT` runs
 * against the driver and attaches navigation / resources / cookies /
 * documentInfo onto the entry — same shape nightwatch and service produce
 * via `applyPerformanceData`.
 */
export function captureNavigationTrace(
  capturer: SessionCapturer,
  onInjected: () => void,
  isFinalized: () => boolean,
  entry?: CommandLog,
  args?: unknown[],
  driver?: unknown
): void {
  void (async () => {
    try {
      // A navigation replaced the document, so the previous page's collector is
      // gone — (re)inject on every navigation so each visited page's DOM (and
      // field edits) is captured, not just the first. onInjected keeps the
      // first-injection flag other capture paths read.
      onInjected()
      await capturer.injectScript()
      if (entry && driver) {
        await capturePerformance(capturer, driver, entry, args)
      }
      await capturer.captureTrace()
      if (!capturer.bidiActive) {
        await capturer.captureBrowserLogs()
      }
    } catch (err) {
      if (!isFinalized()) {
        log.warn(`Trace capture failed: ${errorMessage(err)}`)
      }
    }
  })()
}

async function capturePerformance(
  capturer: SessionCapturer,
  driver: unknown,
  entry: CommandLog,
  args: unknown[] | undefined
): Promise<void> {
  const exec = getDriverOriginals().executeScript
  if (!exec) {
    return
  }
  try {
    // Brief settle so navigation entries populate before we read them.
    await new Promise((resolve) => setTimeout(resolve, 500))
    const raw = (await exec(
      driver as SeleniumDriverLike,
      CAPTURE_PERFORMANCE_SCRIPT
    )) as CapturedPerformancePayload | undefined
    if (applyPerformanceData(entry, raw, args?.[0] as string | undefined)) {
      capturer.sendReplaceCommand(entry.timestamp ?? Date.now(), entry)
    }
  } catch (err) {
    const msg = errorMessage(err)
    // Session torn down between the navigation command and the deferred
    // perf-script execution — expected during teardown of the last test.
    if (
      msg.includes('ECONNREFUSED') ||
      msg.includes('no such session') ||
      msg.includes('invalid session id')
    ) {
      return
    }
    log.warn(`Performance capture failed: ${msg}`)
  }
}

export interface OnCommandCtx {
  readonly sessionCapturer: SessionCapturer | undefined
  readonly testManager: TestManager | undefined
  readonly retryTracker: RetryTracker
  readonly options: { captureScreenshots: boolean; mode?: DevToolsMode }
  readonly scriptInjected: boolean
  readonly finalized: boolean
  readonly driver: SeleniumDriverLike | undefined
  readonly actionSnapshots: ActionSnapshot[]
  readonly snapshotCaptures: Promise<void>[]
  setScriptInjected(v: boolean): void
}

function attachScreenshotAsync(
  capturer: SessionCapturer,
  entry: CommandLog
): void {
  const ts = entry.timestamp
  capturer
    .takeScreenshot()
    .then((shot) => {
      if (shot) {
        entry.screenshot = shot
        capturer.sendReplaceCommand(ts, entry)
      }
    })
    .catch(() => {})
}

/**
 * After a DOM-mutating element command (type/click/clear/submit), drain the
 * collector so the page's field edits (value/checked) land in the mutation
 * stream before a later navigation discards the page. Fire-and-forget; trace
 * mode only.
 */
function maybeDrainAfterDomCommand(
  ctx: OnCommandCtx,
  capturer: SessionCapturer,
  cmd: CapturedCommand
): void {
  if (
    ctx.options.mode === 'trace' &&
    cmd.fromElement &&
    DOM_MUTATING_ELEMENT_COMMANDS.has(cmd.command) &&
    !ctx.finalized
  ) {
    void capturer.captureTrace().catch(() => {})
  }
}

/**
 * Plugin-side handler for a single command capture event. Pulled out of the
 * plugin class so the hot path stays readable and the post-capture branches
 * (screenshot, find-result enrichment, navigation trace) are easier to test.
 */
export async function handleOnCommand(
  ctx: OnCommandCtx,
  cmd: CapturedCommand
): Promise<void> {
  const capturer = ctx.sessionCapturer
  const testManager = ctx.testManager
  if (!capturer || !testManager) {
    return
  }
  const test = testManager.getOrEnsureTest()
  if (!test) {
    return
  }
  const entry = await captureOrReplaceCommand({
    capturer,
    retryTracker: ctx.retryTracker,
    test,
    cmd
  })
  const error = cmd.error ? toError(cmd.error) : undefined
  if (ctx.options.captureScreenshots && !error) {
    attachScreenshotAsync(capturer, entry)
  }
  // Enrich opaque WebElement results with tag + text preview for the UI.
  if (
    !error &&
    cmd.rawResult &&
    (cmd.command === 'findElement' || cmd.command === 'findElements')
  ) {
    void enrichFindResult(capturer, cmd.rawResult, entry, entry.timestamp)
  }
  if (capturer.isNavigationCommand(cmd.command) && !cmd.fromElement) {
    captureNavigationTrace(
      capturer,
      () => ctx.setScriptInjected(true),
      () => ctx.finalized,
      entry,
      cmd.args,
      ctx.driver
    )
  }
  maybeDrainAfterDomCommand(ctx, capturer, cmd)
  if (
    ctx.options.mode === 'trace' &&
    !error &&
    ctx.driver &&
    mapCommandToAction(cmd.command)
  ) {
    const driver = ctx.driver
    ctx.snapshotCaptures.push(
      captureActionSnapshot(driver, cmd.command).then((snap) => {
        if (snap) {
          ctx.actionSnapshots.push(snap)
        }
      })
    )
  }
}
