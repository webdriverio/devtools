import type { BaseDevToolsOptions } from '@wdio/devtools-shared'
import type { ServiceOptions } from '@wdio/devtools-service'
import type { DevToolsOptions as SeleniumOptions } from '@wdio/selenium-devtools/types'
import type { DevToolsOptions as NightwatchOptions } from '@wdio/nightwatch-devtools/types'

import type { FeatureId } from './features.js'
import type {
  AdapterId,
  Feature,
  OptionTarget as AnyOptionTarget
} from './types.js'

// Typed on the feature ids, so an option naming a misspelt feature fails to compile.
type OptionTarget = AnyOptionTarget<FeatureId>

type OwnKeys<T> = Exclude<keyof T, keyof BaseDevToolsOptions>

const WHERE_THE_BACKEND_LISTENS = {
  notFeature: 'Where the dashboard backend listens.'
}

// Keyed on the option types themselves, so a new option fails to compile until it is placed.
export const SHARED_OPTIONS: Record<keyof BaseDevToolsOptions, OptionTarget> = {
  port: WHERE_THE_BACKEND_LISTENS,
  hostname: WHERE_THE_BACKEND_LISTENS,
  screencast: { feature: 'filmstrip' },
  captureAssertions: { feature: 'assertion-capture' },
  mode: { feature: 'trace-mode' },
  traceFormat: { feature: 'trace-format' },
  traceGranularity: { feature: 'per-test-granularity' },
  tracePolicy: { feature: 'retry-retention' },
  filmstrip: { feature: 'filmstrip' },
  emitArtifactsManifest: { feature: 'artifacts-manifest' }
}

export const SERVICE_OPTIONS: Record<OwnKeys<ServiceOptions>, OptionTarget> = {
  screenshot: { feature: 'per-test-artifacts' },
  video: { feature: 'per-test-artifacts' },
  devtoolsCapabilities: { feature: 'dashboard-window' }
}

export const SELENIUM_OPTIONS: Record<
  OwnKeys<SeleniumOptions>,
  OptionTarget
> = {
  openUi: { feature: 'dashboard-window' },
  captureScreenshots: { feature: 'screenshot-switch' },
  rerunCommand: { feature: 'run-controls' },
  headless: { feature: 'headless' },
  screenshot: { feature: 'per-test-artifacts' },
  video: { feature: 'per-test-artifacts' }
}

export const NIGHTWATCH_OPTIONS: Record<
  OwnKeys<NightwatchOptions>,
  OptionTarget
> = {
  bidi: { feature: 'auto-bidi' },
  screenshot: { feature: 'per-test-artifacts' },
  video: { feature: 'per-test-artifacts' }
}

const TURNS_THE_ADAPTER_ON = {
  notFeature: 'Turns the adapter on.'
}

// Internal handshake variables (rerun reuse, runner cwd) come from the shared contract and are set by the backend, not by users.
/** `enable()` keywords, pytest flags and ini keys, and `DEVTOOLS_*` variables; a test reads the real ones from the source. */
export const PYTHON_OPTIONS: Record<string, OptionTarget> = {
  host: WHERE_THE_BACKEND_LISTENS,
  port: WHERE_THE_BACKEND_LISTENS,
  webdriver_cls: {
    notFeature:
      'Which WebDriver class to instrument, for a project that subclasses it.'
  },
  trace: { feature: 'trace-mode' },
  filmstrip: { feature: 'filmstrip' },
  a11y: { feature: 'a11y-overlay' },
  trace_policy: { feature: 'retry-retention' },
  trace_granularity: { feature: 'per-test-granularity' },
  '--devtools': TURNS_THE_ADAPTER_ON,
  '--devtools-trace': { feature: 'trace-mode' },
  '--devtools-trace-granularity': { feature: 'per-test-granularity' },
  '--devtools-trace-policy': { feature: 'retry-retention' },
  devtools: TURNS_THE_ADAPTER_ON,
  devtools_trace: { feature: 'trace-mode' },
  devtools_trace_granularity: { feature: 'per-test-granularity' },
  devtools_trace_policy: { feature: 'retry-retention' },
  DEVTOOLS_HOST: WHERE_THE_BACKEND_LISTENS,
  DEVTOOLS_PORT: WHERE_THE_BACKEND_LISTENS,
  DEVTOOLS_BACKEND_CMD: {
    notFeature: 'Which command launches the dashboard backend.'
  },
  DEVTOOLS_ENABLE: TURNS_THE_ADAPTER_ON,
  DEVTOOLS_BIDI: { feature: 'auto-bidi' },
  DEVTOOLS_OPEN: { feature: 'dashboard-window' },
  DEVTOOLS_TRACE: { feature: 'trace-mode' },
  DEVTOOLS_FILMSTRIP: { feature: 'filmstrip' },
  DEVTOOLS_A11Y: { feature: 'a11y-overlay' },
  DEVTOOLS_TRACE_POLICY: { feature: 'retry-retention' },
  DEVTOOLS_TRACE_GRANULARITY: { feature: 'per-test-granularity' }
}

export const OPTION_MAPS: Record<
  AdapterId | 'shared',
  Record<string, OptionTarget>
> = {
  shared: SHARED_OPTIONS,
  'devtools-service': SERVICE_OPTIONS,
  'selenium-devtools': SELENIUM_OPTIONS,
  'nightwatch-devtools': NIGHTWATCH_OPTIONS,
  'selenium-devtools-py': PYTHON_OPTIONS
}

/** Every option names a declared feature, or says why it is not one. */
export function optionProblems(features: readonly Feature[]): string[] {
  const ids = new Set(features.map((f) => f.id))
  return Object.entries(OPTION_MAPS).flatMap(([owner, options]) =>
    Object.entries(options).flatMap(([option, target]) => {
      if ('feature' in target) {
        return ids.has(target.feature)
          ? []
          : [
              `option ${owner}.${option}: names unknown feature ${target.feature}`
            ]
      }
      return target.notFeature.trim()
        ? []
        : [`option ${owner}.${option}: not a feature, but no reason`]
    })
  )
}
