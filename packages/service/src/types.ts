// WDIO-specific types live here. Cross-package types come from @wdio/devtools-shared.
//
// Re-exports below maintain backwards compatibility for external consumers of
// @wdio/devtools-service/types. New code should import directly from
// @wdio/devtools-shared.

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

// ScreencastFrame, ScreencastOptions hoisted to @wdio/devtools-shared; re-exported
// here for backwards compatibility with existing service-internal imports.
import type {
  DevToolsMode,
  ScreencastOptions,
  TraceFormat
} from '@wdio/devtools-shared'
export type {
  DevToolsMode,
  ScreencastFrame,
  ScreencastOptions,
  TraceFormat
} from '@wdio/devtools-shared'

export interface ExtendedCapabilities extends WebdriverIO.Capabilities {
  'wdio:devtoolsOptions'?: ServiceOptions
}

export interface ServiceOptions {
  /**
   * port to launch the application on (default: random)
   */
  port?: number
  /**
   * hostname to launch the application on
   * @default localhost
   */
  hostname?: string
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
  /**
   * Screencast recording options. When enabled, a continuous video of the
   * browser session is recorded and saved as a .webm file. Chrome/Chromium
   * uses CDP push mode; all other browsers fall back to screenshot polling.
   */
  screencast?: ScreencastOptions
  /** `live` (default) launches the DevTools UI; `trace` skips it. */
  mode?: DevToolsMode
  /**
   * Skip launching the devtools dashboard backend and Chrome UI window
   * (default: false). Use when only trace recording is needed — no
   * debug dashboard, no extra Chrome window, no backend server.
   */
  disableDebugger?: boolean
  /** Trace output layout — `zip` (default) writes a single archive,
   *  `ndjson-directory` unpacks into `trace-<id>/`. Only applies in trace mode. */
  traceFormat?: TraceFormat
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
