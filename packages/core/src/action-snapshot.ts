// Adapter-agnostic per-action snapshot capture. Each adapter wires its own
// `runScript`, `takeScreenshot`, etc. shim so the actual capture pipeline
// (timeouts, fallbacks, snapshot serialization) lives in one place.

import { buildElementScripts } from '@wdio/devtools-shared/element-scripts'
import {
  serializeWebSnapshot,
  serializeMobileSnapshot
} from './element-snapshot.js'
import type { AccessibilityNode, BrowserElementInfo } from './element-types.js'
import { performance } from 'node:perf_hooks'
import { xmlToJSON } from './locators/xml-parsing.js'
import {
  generateAllElementLocators,
  getDefaultFilters
} from './locators/index.js'
import {
  SNAPSHOT_DRIVER_PROBE_TIMEOUT_MS,
  SNAPSHOT_PROBE_TIMEOUT_MS,
  withTimeout
} from './with-timeout.js'
import { startCaptureTimer, type CaptureTimer } from './capture-timing.js'
import type {
  ActionSnapshot,
  CaptureProbe,
  CaptureTrigger,
  TestRunnerId
} from '@wdio/devtools-shared'

export type ScriptRunner = (scriptSrc: string) => Promise<unknown>

export interface CaptureActionSnapshotInput {
  command: string
  /** The logged command's timestamp. Export claims snapshots by exact equality
   * (`claimAfter`/`elementsAt`) and slices them by command time, so a snapshot
   * stamped with its own capture time binds to no action at all. */
  timestamp?: number
  /** Browser script runner — omit on native mobile where Appium can't execute JS. */
  runScript?: ScriptRunner
  takeScreenshot?: () => Promise<string | null | undefined>
  getUrl?: () => Promise<string | null | undefined>
  getTitle?: () => Promise<string | null | undefined>
  /** Page-source XML fetcher for native mobile — used instead of runScript. */
  getPageSource?: () => Promise<string | undefined>
  /** Platform identifier for mobile snapshot formatting ('android' | 'ios'). */
  platform?: 'android' | 'ios'
  /** Runner this capture belongs to — decides which text-locator dialect the
   *  injected scripts emit. Omitted → the portable XPath form. */
  runner?: TestRunnerId
  /** Why this capture ran, for the opt-in capture timing report. Omitted → `action`. */
  trigger?: CaptureTrigger
}

/** `pending` unchanged; with a timer and a probe that will really be issued, also timed. */
function timed<T>(
  timer: CaptureTimer | undefined,
  probe: CaptureProbe,
  issued: unknown,
  pending: Promise<T>
): Promise<T> {
  return timer && issued ? timer.track(probe, pending) : pending
}

async function runWith<T>(
  runScript: ScriptRunner | undefined,
  scriptSrc: string,
  fallback: T
): Promise<T> {
  if (!runScript) {
    return fallback
  }

  return withTimeout(
    // A driver can answer `null` rather than reject (no-such-session, a script
    // error swallowed by the transport). Passing that through hands the
    // serializers a non-array where they expect one, which throws and loses the
    // WHOLE snapshot — screenshot, url and all — not just the probe.
    runScript(scriptSrc).then((r) =>
      r === null || r === undefined ? fallback : (r as T)
    ),
    SNAPSHOT_PROBE_TIMEOUT_MS,
    fallback
  ).catch(() => fallback)
}

/**
 * Run one driver-side probe under a timeout, resolving to `undefined` on a
 * timeout, a rejection, or a synchronous throw.
 *
 * Every probe is guarded, not just the in-page scripts: a framework whose
 * url/title/screenshot readers go through its own command queue blocks
 * indefinitely when called from inside a command hook, and an unguarded probe
 * in this `Promise.all` stranded the entire capture — observed as 10 of 14
 * Nightwatch captures never settling, so those actions reached the trace with
 * no DOM, no a11y tree and no element rects at all.
 */
function probe<T>(
  read: (() => Promise<T | null | undefined>) | undefined
): Promise<T | undefined> {
  if (!read) {
    return Promise.resolve(undefined)
  }
  // `Promise.resolve().then(read)` so a probe that throws synchronously becomes
  // a rejection this catch can absorb, rather than escaping the Promise.all.
  return withTimeout(
    Promise.resolve()
      .then(read)
      .then((value) => value ?? undefined),
    SNAPSHOT_DRIVER_PROBE_TIMEOUT_MS,
    undefined
  ).catch(() => undefined)
}

/** Native-mobile snapshot text + locators, derived from the page-source XML. */
function fromPageSource(
  pageSource: string,
  platform: 'android' | 'ios'
): { snapshotText: string; elements: unknown[] } {
  const jsonTree = xmlToJSON(pageSource)
  let snapshotText = `[${platform}]`
  if (jsonTree) {
    jsonTree.attributes._sourceXML = pageSource
    snapshotText = serializeMobileSnapshot(jsonTree, {
      platform,
      sourceXML: pageSource
    })
  }
  try {
    const filters = getDefaultFilters(platform, false)
    return {
      snapshotText,
      elements: generateAllElementLocators(pageSource, {
        platform,
        viewportSize: { width: 9999, height: 9999 },
        filters,
        inViewportOnly: false
      })
    }
  } catch {
    // Non-fatal — snapshot text is the primary deliverable.
    return { snapshotText, elements: [] }
  }
}

/**
 * Issue every probe of one capture together.
 *
 * Probe order is load-bearing, not cosmetic. A driver serialises requests per
 * session, so `Promise.all` starting them together still has them served in
 * the order issued, and the screenshot is by far the slowest. Issued first, it
 * delayed the cheap reads behind it by hundreds of ms, long enough for the next
 * command to navigate: a fill on the login page reported the page its submit
 * had already reached. Cheapest-and-most-order-sensitive first, screenshot
 * last; the screenshot is served no later than before.
 */
function readProbes(
  input: CaptureActionSnapshotInput,
  isNativeMobile: boolean,
  timer: CaptureTimer | undefined
) {
  // The same pair the backend serves the Python adapter, so the two cannot
  // capture different things. `elements` carries bounds: the per-action
  // element rects drive A8 input points.
  const scripts = buildElementScripts(input.runner)
  return Promise.all([
    timed(timer, 'url', input.getUrl, probe(input.getUrl)),
    timed(timer, 'title', input.getTitle, probe(input.getTitle)),
    isNativeMobile
      ? timed(timer, 'pageSource', true, probe(input.getPageSource))
      : undefined,
    timed(
      timer,
      'accessibilityTree',
      input.runScript,
      runWith<AccessibilityNode[]>(
        input.runScript,
        scripts.accessibilityTree,
        []
      )
    ),
    timed(
      timer,
      'elements',
      input.runScript,
      runWith<BrowserElementInfo[]>(input.runScript, scripts.elements, [])
    ),
    timed(
      timer,
      'screenshot',
      input.takeScreenshot,
      probe(input.takeScreenshot)
    )
  ])
}

export async function captureActionSnapshot(
  input: CaptureActionSnapshotInput
): Promise<ActionSnapshot | null> {
  try {
    const timestamp = input.timestamp ?? Date.now()
    const isNativeMobile = !input.runScript && !!input.getPageSource
    const timer = startCaptureTimer(
      input.command,
      input.trigger ?? 'action',
      isNativeMobile
    )
    const [url, title, pageSource, tree, elements, shot] = await readProbes(
      input,
      isNativeMobile,
      timer
    )

    const processedFrom = timer ? performance.now() : 0
    const mobile =
      isNativeMobile && pageSource
        ? fromPageSource(pageSource, input.platform ?? 'android')
        : undefined
    const snapshotText =
      mobile?.snapshotText ?? serializeWebSnapshot(tree, { url, title })
    timer?.finish(processedFrom)

    return {
      timestamp,
      command: input.command,
      url,
      title,
      screenshot: shot ?? undefined,
      elements: mobile?.elements ?? elements,
      snapshotText
    }
  } catch {
    return null
  }
}
