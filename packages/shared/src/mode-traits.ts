import type { DevToolsMode } from './types.js'

const MODE_TRAITS: Record<
  DevToolsMode,
  {
    startsBackend: boolean
    capturesTrace: boolean
    forcesManifest: boolean
  }
> = {
  live: {
    startsBackend: true,
    capturesTrace: false,
    forcesManifest: false
  },
  trace: {
    startsBackend: false,
    capturesTrace: true,
    forcesManifest: false
  },
  telemetry: {
    startsBackend: false,
    capturesTrace: false,
    forcesManifest: true
  }
}

const KNOWN_MODES = Object.keys(MODE_TRAITS) as DevToolsMode[]

function assertKnownMode(mode: unknown): asserts mode is DevToolsMode {
  if (!KNOWN_MODES.some((known) => known === mode)) {
    throw new Error(
      `Unknown DevTools mode "${String(mode)}"; expected one of: ${KNOWN_MODES.join(', ')}`
    )
  }
}

/** Adapters call this where options arrive, so a typo fails at setup rather than on the first command. */
export function assertDevToolsMode(
  mode: unknown
): asserts mode is DevToolsMode | undefined {
  if (mode !== undefined) {
    assertKnownMode(mode)
  }
}

function traitsOf(mode: DevToolsMode): (typeof MODE_TRAITS)[DevToolsMode] {
  assertKnownMode(mode)
  return MODE_TRAITS[mode]
}

export function startsBackend(mode: DevToolsMode = 'live'): boolean {
  return traitsOf(mode).startsBackend
}

export function capturesTrace(mode: DevToolsMode = 'live'): boolean {
  return traitsOf(mode).capturesTrace
}

/** Live feeds the dashboard and trace feeds the zip; telemetry feeds neither, so nothing observes the page. */
export function observesPage(mode: DevToolsMode = 'live'): boolean {
  return startsBackend(mode) || capturesTrace(mode)
}

/** Telemetry writes its manifest even when the trace-mode switch that gates it is off. */
export function forcesManifest(mode: DevToolsMode = 'live'): boolean {
  return traitsOf(mode).forcesManifest
}

export interface ModeScopedOptions {
  traceFormat?: unknown
  traceGranularity?: unknown
  tracePolicy?: unknown
  filmstrip?: unknown
  screenshot?: unknown
  video?: unknown
  traceResources?: unknown
  emitArtifactsManifest?: boolean
  screencast?: { enabled?: boolean }
}

const TRACE_ONLY_OPTIONS = [
  'traceFormat',
  'traceGranularity',
  'tracePolicy',
  'filmstrip',
  'screenshot',
  'video',
  'traceResources'
] as const

/** Names each option the user set that this mode drops, so a run that records nothing says why; undefined when every set option applies. */
export function ignoredOptionsWarning(
  options: ModeScopedOptions,
  mode: DevToolsMode = 'live'
): string | undefined {
  const ignored = capturesTrace(mode)
    ? []
    : TRACE_ONLY_OPTIONS.filter((key) => options[key] !== undefined).map(
        (key) => `\`${key}\` (trace mode only)`
      )
  if (
    !capturesTrace(mode) &&
    !forcesManifest(mode) &&
    options.emitArtifactsManifest === true
  ) {
    ignored.push('`emitArtifactsManifest` (trace and telemetry modes only)')
  }
  if (forcesManifest(mode) && options.emitArtifactsManifest === false) {
    ignored.push(
      '`emitArtifactsManifest: false` (telemetry always writes the manifest)'
    )
  }
  if (!startsBackend(mode) && options.screencast?.enabled === true) {
    ignored.push(
      capturesTrace(mode)
        ? '`screencast.enabled` (live mode only; `filmstrip` and `video` decide recording, the quality/interval fields still apply)'
        : '`screencast.enabled` (live mode only)'
    )
  }
  return ignored.length
    ? `${mode} mode ignores ${ignored.join(', ')}.`
    : undefined
}
