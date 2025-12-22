import type { RunCapabilities } from './types.js'

export const DEFAULT_CAPABILITIES: RunCapabilities = {
  canRunSuites: true,
  canRunTests: true
}

export const FRAMEWORK_CAPABILITIES: Record<string, RunCapabilities> = {
  cucumber: { canRunSuites: true, canRunTests: false }
}
