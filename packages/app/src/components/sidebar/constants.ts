import type { RunCapabilities } from './types.js'

/** The uid the header control names the whole tree with. `RunnerRequestBody`'s
 *  `runAll` flag is derived from it, so it is also the signal that a refusal
 *  has to be judged against `canRunAll` — not against the `canRunSuites` its
 *  `entryType` would otherwise select. */
export const RUN_ALL_UID = '*'

export const SINGLE_TEST_REFUSAL =
  'Single-test execution is not supported by this framework.'
export const SUITE_REFUSAL =
  'Suite execution is not supported by this framework.'
export const RUN_ALL_REFUSAL =
  'Running every test at once is not supported by this framework.'

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
