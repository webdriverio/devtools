/** Re-instruments the page after every navigation, which a `<script>`-injected collector does not survive. */

import logger from '@wdio/logger'
import type { SessionCapturer } from '../session.js'
import type { NightwatchBrowser, NightwatchChainable } from '../types.js'

const log = logger('@wdio/nightwatch-devtools:navigation')

/**
 * Wrap browser navigation methods (url / navigate / navigateTo) to inject
 * the DevTools script after every navigation.
 *
 * Uses `browser` from the closure (not `this` inside perform) so it works
 * for both standard Nightwatch (chainable API) and Cucumber async/await mode
 * where `this` inside a perform callback is not the browser.
 */
export function wrapNavigation(
  browser: NightwatchBrowser,
  sessionCapturer: SessionCapturer
): void {
  // Cast once for dynamic method access — Nightwatch's typed surface
  // doesn't enumerate every command, but they all live on the same object.
  // Return type is `unknown` because wrapNav has to handle both
  // Nightwatch's chainable API (returns a chainable with `.perform`) and
  // Cucumber async/await (returns a Promise) — we narrow at each branch.
  const b = browser as unknown as Record<
    string,
    (...args: unknown[]) => unknown
  >

  const wrapNav = (methodName: string) => {
    if (typeof b[methodName] !== 'function') {
      return
    }
    const original = b[methodName].bind(browser)

    b[methodName] = function (...args: unknown[]) {
      // `browser.url()` is BOTH a navigation and a getter: with no url it just
      // reads the current one, which is how `assert.urlContains` reads it from
      // inside Nightwatch's own queue. Treating that read as a navigation
      // re-injected the collector and forced an anchored drain mid-test — real
      // round trips against the page for a command that changed nothing — and
      // logged the capture callback's whole function body as the "url".
      if (typeof args[0] !== 'string') {
        return original(...args)
      }
      const result = original(...args)

      const injectAndCapture = () => {
        log.info(`[nav] ${methodName}(${args[0] ?? ''}) — injecting script`)
        return (
          sessionCapturer
            .injectScript(browser)
            // Anchored: the just-injected collector anchors the document
            // asynchronously, so an unanchored drain beats it and this page's
            // DOM never reaches the trace.
            .then(() => sessionCapturer.captureTrace(browser, true))
            .catch((err: Error) =>
              log.error(`Failed to inject script: ${(err as Error).message}`)
            )
        )
      }

      const chainable = result as NightwatchChainable | undefined
      if (chainable && typeof chainable.perform === 'function') {
        // Standard Nightwatch (chained API). Hung off the command's OWN
        // thenable, not a queued `perform()`: a queued callback is discarded
        // when a failing test aborts the rest of the queue, so the destination
        // of a navigation in a failing test was never instrumented at all
        // (measured: 2 of 3 navigations skipped, and with them the first
        // document's entire DOM). The chainable is itself thenable, and
        // resolving it means the navigation finished — the same signal
        // `perform` gave, minus the dependency on the queue surviving.
        //
        // `result` is returned unchanged so `browser.url(…).waitFor…()`
        // chaining still works; the injection runs as a side effect.
        void Promise.resolve(result)
          .then(injectAndCapture)
          .catch(() => {})
        return result
      }
      // Cucumber async/await: result is a Promise (or thenable).
      // Return the AUGMENTED promise so that `await browser.url(...)` in
      // the step definition waits for injectAndCapture to finish before
      // Cucumber moves to the next step. Without this the injection races
      // with the next step's commands (e.g. setValue), causing stale-element
      // errors because the script-tag insertion mutates the DOM mid-form.
      return Promise.resolve(result)
        .then(injectAndCapture)
        .catch(() => {})
    }
  }

  wrapNav('url')
  wrapNav('navigate')
  wrapNav('navigateTo')

  log.info('✓ Script injection wrapped')
}
