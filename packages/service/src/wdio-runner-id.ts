// This adapter's runner identity, and the stamping of it onto session metadata.
// WDIO's own `framework` config value IS the runner id, so it is read off the
// session rather than restated. Named for the WDIO runner to stay distinct from
// core's `run-id.ts`, which is the unrelated per-run identity.

import {
  isTestRunnerId,
  type Metadata,
  type TestRunnerId,
  type TraceType
} from '@wdio/devtools-shared'

/** WDIO's own default framework, and the answer for a standalone session whose
 *  options carry no framework at all. */
const DEFAULT_RUNNER: TestRunnerId = 'mocha'

export function wdioRunnerId(browser: WebdriverIO.Browser): TestRunnerId {
  // `browser.options` is the merged testrunner config at runtime, but its static
  // type is the remote-options subset, which declares no `framework`. Optional
  // because a multiremote/standalone handle can reach here without options.
  const framework = (browser.options as { framework?: unknown } | undefined)
    ?.framework
  return isTestRunnerId(framework) ? framework : DEFAULT_RUNNER
}

/** Put the runner on the capturer's own metadata — the copy the trace exporter
 *  reads on its way into the zip's `context-options`. `sendUpstream` alone feeds
 *  the live dashboard and never reaches it. */
export function stampRunnerMetadata(
  capturer: { metadata?: Metadata },
  browser: WebdriverIO.Browser,
  type: TraceType
): void {
  capturer.metadata = {
    type,
    ...capturer.metadata,
    runner: wdioRunnerId(browser)
  }
}
