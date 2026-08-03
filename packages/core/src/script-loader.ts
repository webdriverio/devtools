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
 * Load the `@wdio/devtools-script` browser preload, wrapped in an async IIFE
 * so its top-level `await` works inside a regular `<script>` element body.
 * Shared by selenium-devtools and nightwatch-devtools, which both inject the
 * script via `document.createElement('script')` rather than BiDi preload (the
 * WDIO service uses `browser.scriptAddPreloadScript`, which doesn't need the
 * wrap and stays in its own adapter).
 */
export async function loadInjectableScript(): Promise<string> {
  const scriptPath = require.resolve('@wdio/devtools-script')
  const scriptDir = path.dirname(scriptPath)
  const preloadScriptPath = path.join(scriptDir, 'script.js')
  const scriptContent = await fs.readFile(preloadScriptPath, 'utf-8')
  return `(async function() { ${scriptContent} })()`
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
