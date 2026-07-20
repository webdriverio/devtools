// WDIO-specific types live here. Cross-package types come from @wdio/devtools-shared.
//
// Re-exports below maintain backwards compatibility for external consumers of
// @wdio/devtools-service/types. New code should import directly from
// @wdio/devtools-shared.

import type { SnapshotResult } from '@wdio/devtools-core/element-types'

export {
  TraceType,
  type CommandLog,
  type ConsoleLog,
  type DocumentInfo,
  type LogLevel,
  type Metadata,
  type NetworkRequest,
  type PerformanceData,
  type PreservedAttempt,
  type PreservedStep,
  type ScreencastInfo,
  type TestStatus,
  type TraceLog,
  type Viewport
} from '@wdio/devtools-shared'

import type {
  BaseDevToolsOptions,
  TraceScreenshotPolicy,
  TraceVideoPolicy
} from '@wdio/devtools-shared'

// ScreencastFrame, ScreencastOptions hoisted to @wdio/devtools-shared; re-exported
// here for backwards compatibility with existing service-internal imports.
export type {
  DevToolsMode,
  ScreencastFrame,
  ScreencastOptions,
  TraceFormat,
  TraceGranularity,
  TraceRetentionPolicy
} from '@wdio/devtools-shared'

export interface ExtendedCapabilities extends WebdriverIO.Capabilities {
  'wdio:devtoolsOptions'?: ServiceOptions
}

export interface ServiceOptions extends BaseDevToolsOptions {
  /** Per-test screenshot capture, attached to the trace artifacts and inline to
   *  Allure. `off` (default) | `on` | `only-on-failure`. Trace mode +
   *  `traceGranularity: 'test'` only. WDIO-service-specific for now. */
  screenshot?: TraceScreenshotPolicy
  /** Per-test video (screencast) capture, retained per the given policy and
   *  attached inline to Allure. `off` (default) or a retention policy. Trace
   *  mode + `traceGranularity: 'test'` only. WDIO-service-specific for now. */
  video?: TraceVideoPolicy
  /** Write the `devtools-artifacts-<sessionId>.json` manifest next to the trace
   *  — the generic index reporters/CI consume to discover produced artifacts.
   *  Off by default (WDIO auto-attaches per-test traces to Allure directly);
   *  auto-enabled when `@wdio/allure-reporter` is in the config, since
   *  session/spec-scoped Allure attach reads the manifest. */
  emitArtifactsManifest?: boolean
  /**
   * capabilities used to launch the devtools application
   * @default
   * ```ts
   * {
   *   browserName: 'chrome',
   *   'goog:chromeOptions': {
   *     args: ['--window-size=1200,800']
   *   }
   * }
   */
  devtoolsCapabilities?: WebdriverIO.Capabilities
}

declare namespace WebdriverIO {
  interface ServiceOption extends ServiceOptions {}
  interface Capabilities {}
  interface Browser {
    // CDP escape hatch present at runtime in Chrome/Chromium sessions but
    // omitted from WDIO's public Browser type. Returns Puppeteer's top-level
    // browser object — see screencast.ts for the local shape we use.
    getPuppeteer?: () => Promise<unknown>
    // BiDi-specific WDIO method, present at runtime when BiDi is active.
    sessionSubscribe?: (opts: { events: string[] }) => Promise<unknown>
    // Runtime DOM snapshot for agent auto-healing. Added by
    // @wdio/devtools-service in the before hook.
    getSnapshot(options?: { inViewportOnly?: boolean }): Promise<SnapshotResult>
  }
}

declare module '@wdio/reporter' {
  interface TestStats {
    file?: string
    line?: number
    column?: number
    callSource?: string
    featureFile?: string
    featureLine?: number
    // Cucumber pickle augmentations (the WDIO Cucumber adapter attaches these
    // on scenarios; @wdio/reporter's base types don't include them). `argument`
    // already exists in the base with a different shape, so reads of its
    // Cucumber-specific fields stay locally cast in reporter.ts.
    pickle?: { uri?: string; location?: { line?: number } }
    uri?: string
  }

  interface SuiteStats {
    line?: string | number | null
    callSource?: string
    featureFile?: string
    featureLine?: number
    pickle?: { uri?: string; location?: { line?: number } }
    uri?: string
  }
}

/** Minimal contract `findStepDefinitionLocation` uses when matching against
 *  a Cucumber-expression step. The real instance comes from the optional
 *  `@cucumber/cucumber-expressions` peer — its types are loose across
 *  versions, so we pin only what's invoked. */
export interface CucumberExpressionLike {
  match(text: string): unknown
}

export type StepDef = {
  kind: 'regex' | 'string' | 'expression'
  keyword?: string
  text?: string
  regex?: RegExp
  expr?: CucumberExpressionLike
  file: string
  line: number
  column: number
}
