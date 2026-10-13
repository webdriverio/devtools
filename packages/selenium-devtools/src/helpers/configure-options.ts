import type { DevToolsOptions, ServerLock } from '../types.js'

// A Record over every option, so a key added to DevToolsOptions fails to compile here instead of being silently ignored.
const OPTION_KIND = {
  openUi: 'runtime',
  headless: 'runtime',
  captureScreenshots: 'runtime',
  captureAssertions: 'runtime',
  filmstrip: 'runtime',
  emitArtifactsManifest: 'runtime',
  mode: 'runtime',
  traceFormat: 'runtime',
  traceGranularity: 'runtime',
  tracePolicy: 'runtime',
  screenshot: 'runtime',
  video: 'runtime',
  port: 'server',
  hostname: 'server'
} as const satisfies Record<
  Exclude<keyof DevToolsOptions, 'screencast' | 'rerunCommand'>,
  'runtime' | 'server'
>

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

function isSet<T>(value: T | null | undefined): value is T {
  return value !== undefined && value !== null
}

function copyDefined<K extends ConfigurableKey>(
  target: ConfigurableOptions,
  opts: DevToolsOptions,
  key: K
): void {
  const value = opts[key]
  if (isSet(value)) {
    target[key] = value
  }
}

function isValidPort(port: number): boolean {
  return Number.isInteger(port) && port > 0 && port < 65536
}

/** Returns a warning when a requested option was refused; a reused backend's port/hostname are skipped silently, as that is the rerun working. */
export function applyConfigureOptions(
  target: ConfigurableOptions,
  opts: DevToolsOptions,
  lock?: ServerLock
): string | undefined {
  const requestedServer: ConfigurableKey[] = []
  for (const key of CONFIGURABLE_KEYS) {
    if (OPTION_KIND[key] === 'runtime') {
      copyDefined(target, opts, key)
    } else if (isSet(opts[key])) {
      requestedServer.push(key)
    }
  }
  if (requestedServer.length === 0 || lock === 'reuse') {
    return undefined
  }
  if (lock === 'started') {
    return `configure: ignoring ${requestedServer.join('/')}: the backend start has already begun`
  }
  if (isSet(opts.port) && !isValidPort(opts.port)) {
    return `configure: ignoring invalid port ${opts.port}`
  }
  for (const key of requestedServer) {
    copyDefined(target, opts, key)
  }
  return undefined
}
