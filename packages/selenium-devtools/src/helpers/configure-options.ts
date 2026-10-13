import type { DevToolsOptions, ServerLock } from '../types.js'

type OptionKind = 'boolean' | 'choice' | 'port' | 'host'

// A Record over every option, so a key added to DevToolsOptions fails to compile here instead of being silently ignored.
const OPTION_KIND = {
  openUi: 'boolean',
  headless: 'boolean',
  captureScreenshots: 'boolean',
  captureAssertions: 'boolean',
  filmstrip: 'boolean',
  emitArtifactsManifest: 'boolean',
  mode: 'choice',
  traceFormat: 'choice',
  traceGranularity: 'choice',
  tracePolicy: 'choice',
  screenshot: 'choice',
  video: 'choice',
  port: 'port',
  hostname: 'host'
} as const satisfies Record<
  Exclude<keyof DevToolsOptions, 'screencast' | 'rerunCommand'>,
  OptionKind
>

const EXPECTED: Record<OptionKind, string> = {
  boolean: 'a boolean',
  choice: 'a non-empty string',
  port: 'an integer between 1 and 65535',
  host: 'a non-empty string'
}

type ConfigurableKey = keyof typeof OPTION_KIND

export type ConfigurableOptions = Pick<DevToolsOptions, ConfigurableKey>

export function serverLock(state: {
  isReuse: boolean
  backendStarting: boolean
}): ServerLock | undefined {
  if (state.isReuse) {
    return 'reuse'
  }
  return state.backendStarting ? 'started' : undefined
}

const CONFIGURABLE_KEYS = Object.keys(OPTION_KIND) as ConfigurableKey[]

function isServerKey(key: ConfigurableKey): boolean {
  const kind: OptionKind = OPTION_KIND[key]
  return kind === 'port' || kind === 'host'
}

// JS callers bypass the types (e.g. `headless: process.env.HEADLESS`), and the string 'false' is truthy.
function hasExpectedShape(kind: OptionKind, value: unknown): boolean {
  switch (kind) {
    case 'boolean':
      return typeof value === 'boolean'
    case 'port':
      return (
        typeof value === 'number' &&
        Number.isInteger(value) &&
        value > 0 &&
        value < 65536
      )
    case 'choice':
    case 'host':
      return typeof value === 'string' && value !== ''
  }
}

function describeValue(value: unknown): string {
  return typeof value === 'string' ? `'${value}'` : String(value)
}

function copyOption<K extends ConfigurableKey>(
  target: ConfigurableOptions,
  opts: DevToolsOptions,
  key: K
): void {
  target[key] = opts[key]
}

/** Returns one warning per refused option; a reused backend's port/hostname are skipped silently, as that is the rerun working. */
export function applyConfigureOptions(
  target: ConfigurableOptions,
  opts: DevToolsOptions,
  lock?: ServerLock
): string[] {
  const warnings: string[] = []
  const accepted: ConfigurableKey[] = []
  for (const key of CONFIGURABLE_KEYS) {
    const value: unknown = opts[key]
    if (value === undefined || value === null) {
      continue
    }
    const kind: OptionKind = OPTION_KIND[key]
    if (hasExpectedShape(kind, value)) {
      accepted.push(key)
    } else {
      warnings.push(
        `configure: ignoring ${key}: expected ${EXPECTED[kind]}, got ${describeValue(value)}`
      )
    }
  }
  const server = accepted.filter(isServerKey)
  if (server.length > 0 && lock === 'started') {
    warnings.push(
      `configure: ignoring ${server.join('/')}: the backend start has already begun`
    )
  }
  for (const key of accepted) {
    if (!(lock && isServerKey(key))) {
      copyOption(target, opts, key)
    }
  }
  return warnings
}
