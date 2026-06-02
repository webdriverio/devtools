import logger from '@wdio/logger'
import {
  CAPTURE_PERFORMANCE_SCRIPT,
  applyPerformanceData,
  errorMessage,
  type CapturedPerformancePayload
} from '@wdio/devtools-core'
import { getDriverOriginals, getElementOriginals } from '../driverPatcher.js'
import type { SessionCapturer } from '../session.js'
import type { CommandLog, SeleniumDriverLike } from '../types.js'

const log = logger('@wdio/selenium-devtools:commandPostActions')

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
      elements.slice(0, 5).map(async (el: any) => {
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
  alreadyInjected: boolean,
  onInjected: () => void,
  isFinalized: () => boolean,
  entry?: CommandLog,
  args?: unknown[],
  driver?: unknown
): void {
  void (async () => {
    try {
      if (!alreadyInjected) {
        onInjected()
        await capturer.injectScript()
      }
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
