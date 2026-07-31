import type { RunCapabilities } from './types.js'

export const DEFAULT_CAPABILITIES: RunCapabilities = {
  canRunSuites: true,
  canRunTests: true,
  canRunAll: true
}

export const FRAMEWORK_CAPABILITIES: Record<string, RunCapabilities> = {
  cucumber: { canRunSuites: true, canRunTests: false, canRunAll: true },
  'nightwatch-cucumber': {
    canRunSuites: true,
    canRunTests: false,
    canRunAll: false
  },
  nightwatch: { canRunSuites: true, canRunTests: true, canRunAll: false }
}
