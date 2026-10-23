import type { BaseDevToolsOptions } from '@wdio/devtools-shared'
import type { ServiceOptions } from '@wdio/devtools-service'
import type { DevToolsOptions as SeleniumOptions } from '@wdio/selenium-devtools/types'
import type { DevToolsOptions as NightwatchOptions } from '@wdio/nightwatch-devtools/types'

import type { AdapterId, Capability, OptionTarget } from './types.js'

type OwnKeys<T> = Exclude<keyof T, keyof BaseDevToolsOptions>

const WHERE_THE_BACKEND_LISTENS = {
  notCapability: 'Where the dashboard backend listens.'
}

// Keyed on the option types themselves, so a new option fails to compile until it is placed.
export const SHARED_OPTIONS: Record<keyof BaseDevToolsOptions, OptionTarget> = {
  port: WHERE_THE_BACKEND_LISTENS,
  hostname: WHERE_THE_BACKEND_LISTENS,
  screencast: { capability: 'filmstrip' },
  captureAssertions: { capability: 'assertion-capture' },
  mode: { capability: 'trace-mode' },
  traceFormat: { capability: 'trace-format' },
  traceGranularity: { capability: 'per-test-granularity' },
  tracePolicy: { capability: 'retry-retention' },
  filmstrip: { capability: 'filmstrip' },
  emitArtifactsManifest: { capability: 'artifacts-manifest' }
}

export const SERVICE_OPTIONS: Record<OwnKeys<ServiceOptions>, OptionTarget> = {
  screenshot: { capability: 'per-test-artifacts' },
  video: { capability: 'per-test-artifacts' },
  devtoolsCapabilities: { capability: 'dashboard-window' }
}

export const SELENIUM_OPTIONS: Record<
  OwnKeys<SeleniumOptions>,
  OptionTarget
> = {
  openUi: { capability: 'dashboard-window' },
  captureScreenshots: { capability: 'screenshot-switch' },
  rerunCommand: { capability: 'run-controls' },
  headless: { capability: 'headless' },
  screenshot: { capability: 'per-test-artifacts' },
  video: { capability: 'per-test-artifacts' }
}

export const NIGHTWATCH_OPTIONS: Record<
  OwnKeys<NightwatchOptions>,
  OptionTarget
> = {
  bidi: { capability: 'auto-bidi' },
  screenshot: { capability: 'per-test-artifacts' },
  video: { capability: 'per-test-artifacts' }
}

const TURNS_THE_ADAPTER_ON = {
  notCapability: 'Turns the adapter on.'
}

// Internal handshake variables (rerun reuse, runner cwd) come from the shared contract and are set by the backend, not by users.
/** `enable()` keywords, pytest flags and ini keys, and `DEVTOOLS_*` variables; a test reads the real ones from the source. */
export const PYTHON_OPTIONS: Record<string, OptionTarget> = {
  host: WHERE_THE_BACKEND_LISTENS,
  port: WHERE_THE_BACKEND_LISTENS,
  webdriver_cls: {
    notCapability:
      'Which WebDriver class to instrument, for a project that subclasses it.'
  },
  trace: { capability: 'trace-mode' },
  filmstrip: { capability: 'filmstrip' },
  a11y: { capability: 'a11y-overlay' },
  trace_policy: { capability: 'retry-retention' },
  trace_granularity: { capability: 'per-test-granularity' },
  '--devtools': TURNS_THE_ADAPTER_ON,
  '--devtools-trace': { capability: 'trace-mode' },
  '--devtools-trace-granularity': { capability: 'per-test-granularity' },
  '--devtools-trace-policy': { capability: 'retry-retention' },
  devtools: TURNS_THE_ADAPTER_ON,
  devtools_trace: { capability: 'trace-mode' },
  devtools_trace_granularity: { capability: 'per-test-granularity' },
  devtools_trace_policy: { capability: 'retry-retention' },
  DEVTOOLS_HOST: WHERE_THE_BACKEND_LISTENS,
  DEVTOOLS_PORT: WHERE_THE_BACKEND_LISTENS,
  DEVTOOLS_BACKEND_CMD: {
    notCapability: 'Which command launches the dashboard backend.'
  },
  DEVTOOLS_ENABLE: TURNS_THE_ADAPTER_ON,
  DEVTOOLS_BIDI: { capability: 'auto-bidi' },
  DEVTOOLS_OPEN: { capability: 'dashboard-window' },
  DEVTOOLS_TRACE: { capability: 'trace-mode' },
  DEVTOOLS_FILMSTRIP: { capability: 'filmstrip' },
  DEVTOOLS_A11Y: { capability: 'a11y-overlay' },
  DEVTOOLS_TRACE_POLICY: { capability: 'retry-retention' },
  DEVTOOLS_TRACE_GRANULARITY: { capability: 'per-test-granularity' }
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

/** Every option names a declared capability, or says why it is not one. */
export function optionProblems(capabilities: Capability[]): string[] {
  const ids = new Set(capabilities.map((c) => c.id))
  return Object.entries(OPTION_MAPS).flatMap(([owner, options]) =>
    Object.entries(options).flatMap(([option, target]) => {
      if ('capability' in target) {
        return ids.has(target.capability)
          ? []
          : [
              `option ${owner}.${option}: names unknown capability ${target.capability}`
            ]
      }
      return target.notCapability.trim()
        ? []
        : [`option ${owner}.${option}: not a capability, but no reason`]
    })
  )
}
