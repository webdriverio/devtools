// Document-start injection of the collector via a BiDi preload script.
//
// The `<script>`-append injection in `script-loader.ts` only ever instruments
// the document that is loaded at the time it runs, and a `<script>` dies with
// its document. So a navigation always produces a document we learn about
// afterwards, and everything built on that — when to re-inject, when to drain,
// which action to credit the new DOM to — is reconstruction, and races. A
// preload script registered globally runs in EVERY document before any of its
// script does, so each one instruments itself and anchors its own DOM at its own
// `performance.timeOrigin`. Nothing to detect, nothing to attribute.

import { loadSeleniumSubmodule } from './bidi.js'
import { errorMessage } from './error.js'
import { loadCollectorSource } from './script-loader.js'

interface ScriptManager {
  addPreloadScript: (
    functionDeclaration: string,
    argumentValueList?: unknown[],
    sandbox?: string | null
  ) => Promise<number>
}

/** `selenium-webdriver/bidi/scriptManager`'s default export. Cast at this
 *  boundary — the module ships no types. */
type ScriptManagerFactory = (
  browsingContextIds: unknown,
  driver: unknown
) => Promise<ScriptManager>

/**
 * Register the collector to run at document-start in every document of this
 * session. Returns false when BiDi isn't available, so the caller can fall back
 * to per-document `<script>` injection.
 *
 * Requires the session to have been created with `webSocketUrl: true`; the
 * script manager throws without it.
 */
export async function registerCollectorPreload(
  driver: unknown,
  log?: (level: 'info' | 'warn', message: string) => void
): Promise<boolean> {
  const factory =
    loadSeleniumSubmodule<ScriptManagerFactory>('bidi/scriptManager')
  if (!factory) {
    return false
  }
  try {
    // No browsing-context id, which registers the script GLOBALLY — contexts
    // created later are covered too. Scoping it to the current context would
    // miss exactly the documents this exists to catch.
    const manager = await factory(undefined, driver)
    // Raw source, not the IIFE-wrapped form: a preload script is a function
    // declaration, so the bundle's top-level await works in the body directly.
    await manager.addPreloadScript(
      `async () => { ${await loadCollectorSource()} }`
    )
    log?.('info', '✓ Collector registered at document-start (BiDi preload)')
    return true
  } catch (err) {
    log?.(
      'warn',
      `BiDi preload unavailable, falling back to per-document injection: ${errorMessage(err)}`
    )
    return false
  }
}
