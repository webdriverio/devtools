import fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'

import { errorMessage } from './error.js'

const require = createRequire(import.meta.url)

/** Browser-side expression that is true once the injected collector has
 *  initialised. Shared by the adapters' readiness polls and re-injection
 *  checks so the collector's global name lives in one place. */
export const COLLECTOR_READY_EXPRESSION =
  'typeof window.wdioTraceCollector !== "undefined"'

/**
 * Browser-side expression that drains the collector in one round-trip, atomic
 * against a navigation replacing the document mid-check.
 *
 * `forceAnchor` forces a full-DOM anchor of the CURRENT document before
 * draining. The collector's initial anchor is scheduled asynchronously (after
 * `waitForBody`), so a drain issued right after injecting on a navigation
 * destination beats it and returns nothing — and the destination's buffer then
 * dies with the page, leaving the navigating action's DOM absent entirely.
 *
 * Shared by the two adapters that eval the drain as a string; the WDIO service
 * passes an equivalent function to `browser.execute` instead.
 */
export function collectorDrainExpression(forceAnchor = false): string {
  const call = forceAnchor
    ? 'window.wdioTraceCollector.captureCurrentDom();'
    : ''
  return `if (!(${COLLECTOR_READY_EXPRESSION})) { return null; } ${call} return window.wdioTraceCollector.getTraceData();`
}

/**
 * Where the collector bundle sits relative to the RESOLVED package entry.
 *
 * Two shapes, because the entry is not always the built one. The package's own
 * `exports` points at `dist/script.js`, so the bundle is its neighbour — but
 * the repo tsconfig maps `@wdio/devtools-script` to `packages/script/src/
 * index.ts`, and every resolver that honours those paths lands there instead.
 * That includes `tsx`/`ts-node`, which is how `wdio run <conf>.ts` loads a
 * config: reading `script.js` beside the entry then ENOENTs on
 * `packages/script/src/script.js`, and because the callers only warn, DOM
 * capture is silently lost for the whole run.
 */
export function collectorSourceCandidates(entry: string): string[] {
  const dir = path.dirname(entry)
  return [
    path.join(dir, 'script.js'),
    path.join(dir, '..', 'dist', 'script.js')
  ]
}

/** The collector bundle's raw source. Callers wrap it for their own injection
 *  mechanism — an async IIFE for a `<script>` body, a function declaration for a
 *  BiDi preload script. */
export async function loadCollectorSource(): Promise<string> {
  const candidates = collectorSourceCandidates(
    require.resolve('@wdio/devtools-script')
  )
  const failures: string[] = []
  for (const candidate of candidates) {
    try {
      return await fs.readFile(candidate, 'utf-8')
    } catch (err) {
      // Not this shape — record it and try the next, so a genuine failure
      // reports every place that was looked at rather than only the last.
      failures.push(`${candidate} (${errorMessage(err)})`)
    }
  }
  throw new Error(
    `collector bundle not found — is @wdio/devtools-script built? Looked at: ${failures.join('; ')}`
  )
}

/**
 * The collector bundle wrapped in an async IIFE so its top-level `await` works
 * inside a regular `<script>` element body. Used for instrumenting the document
 * that is loaded RIGHT NOW; documents created later are covered by the BiDi
 * preload script (`registerCollectorPreload`), which takes the raw source.
 */
export async function loadInjectableScript(): Promise<string> {
  return `(async function() { ${await loadCollectorSource()} })()`
}

/** Schemes that carry no test-relevant DOM — the browser's own start page,
 *  inline documents, and driver error pages. */
const NON_INSTRUMENTABLE_SCHEMES = [
  'about:',
  'data:',
  'chrome:',
  'chrome-error:',
  'edge:',
  'moz-extension:',
  'chrome-extension:'
]

function isInstrumentableDocument(url: string | undefined): boolean {
  if (!url) {
    return false
  }
  return !NON_INSTRUMENTABLE_SCHEMES.some((scheme) => url.startsWith(scheme))
}

/**
 * Drain the page-side collector, re-injecting it into the CURRENT document and
 * retrying once when it isn't there.
 *
 * Both injection mechanisms (BiDi preload script, `<script>` append) only cover
 * documents created AFTER the injection, so a document that loads across a
 * session swap — `browser.reloadSession()`, nightwatch cucumber's per-scenario
 * re-navigation — carries no collector. Without one the drain returns nothing
 * and the dashboard replays the PREVIOUS document's DOM for every action on the
 * new page (empty forms, stale screenshots) with no error anywhere. Re-injecting
 * into the live document costs one round trip and its startup anchors the
 * current DOM, so the replay recovers from the next action onward.
 *
 * `drain` must resolve to the collector payload, or a falsy value when the
 * collector isn't reachable — the same `typeof === 'undefined' ? null` atomic
 * probe every adapter already uses. `currentUrl` is only consulted on a miss,
 * to keep recovery off documents that aren't worth instrumenting.
 */
export async function drainCollectorWithRecovery<T>(opts: {
  drain: () => Promise<T | null>
  injectIntoCurrentDocument: () => Promise<void>
  currentUrl?: () => Promise<string | undefined>
  log?: (level: 'info' | 'warn', message: string) => void
}): Promise<T | null> {
  const payload = await opts.drain()
  if (payload) {
    return payload
  }
  if (opts.currentUrl) {
    const url = await opts.currentUrl().catch(() => undefined)
    if (!isInstrumentableDocument(url)) {
      // A session's pre-navigation page has no collector by design; anchoring it
      // would add a phantom "document loaded" row to every run. An unreadable
      // url means the session is gone — nothing to recover into either.
      return null
    }
  }
  opts.log?.('info', 'Collector missing on the current document, re-injecting')
  try {
    await opts.injectIntoCurrentDocument()
  } catch (err) {
    // Best-effort: a failed recovery must not also lose the caller's drain.
    opts.log?.('warn', `Collector re-injection failed: ${errorMessage(err)}`)
    return null
  }
  const recovered = await opts.drain()
  if (!recovered) {
    opts.log?.(
      'warn',
      'Collector still unreachable after re-injection — DOM capture is stale for this document'
    )
  }
  return recovered
}

/**
 * Poll a readiness check until it returns true, or the attempts run out.
 * Defaults to 5 × 200ms = up to 1 second total — chosen empirically to cover
 * the async IIFE init time across browsers we test against.
 */
export async function pollUntilReady(
  check: () => Promise<boolean>,
  opts: { attempts?: number; intervalMs?: number } = {}
): Promise<boolean> {
  const attempts = opts.attempts ?? 5
  const intervalMs = opts.intervalMs ?? 200
  for (let i = 0; i < attempts; i++) {
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
    if (await check()) {
      return true
    }
  }
  return false
}
