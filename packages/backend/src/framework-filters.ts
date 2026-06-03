import type { RunnerRequestBody, TestRunnerId } from '@wdio/devtools-shared'

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export type FilterBuilder = (ctx: {
  specArg?: string
  payload: RunnerRequestBody
}) => string[]

// Map (not object) keeps payload-supplied `framework` from reaching
// prototype methods at dispatch time — CodeQL: unvalidated-dynamic-method-call.
// Keyed by TestRunnerId so adding a new runner forces compile-time updates here.
const FRAMEWORK_FILTERS = new Map<TestRunnerId, FilterBuilder>()

FRAMEWORK_FILTERS.set('cucumber', ({ specArg, payload }) => {
  const filters: string[] = []

  // For feature-level suites, run the entire feature file
  if (payload.suiteType === 'feature' && specArg) {
    // Remove any line number from specArg for feature-level execution
    const featureFile = specArg.split(':')[0]
    filters.push('--spec', featureFile)
    return filters
  }

  // Priority 1: Use feature file with line number for exact scenario targeting (works for examples)
  // Note: Cucumber scenarios are type 'suite', not 'test'
  if (payload.featureFile && payload.featureLine) {
    filters.push('--spec', `${payload.featureFile}:${payload.featureLine}`)
    return filters
  }

  // Priority 2: For specific test reruns with example row number, use exact regex match
  if (payload.entryType === 'test' && payload.fullTitle) {
    // Cucumber fullTitle format: "1: Scenario name" or "2: Scenario name"
    // Extract the row number and scenario name
    // Avoid ReDoS by removing ambiguous \s* before .* - use string operations instead
    const colonIndex = payload.fullTitle.indexOf(':')
    if (colonIndex > 0) {
      const rowNumber = payload.fullTitle.substring(0, colonIndex)
      const scenarioName = payload.fullTitle.substring(colonIndex + 1).trim()
      // Validate row number is digits only
      if (/^\d+$/.test(rowNumber)) {
        // Use spec file filter
        if (specArg) {
          filters.push('--spec', specArg)
        }
        // Use regex to match the exact "rowNumber: scenarioName" pattern
        // This ensures we only run that specific example row
        filters.push(
          '--cucumberOpts.name',
          `^${rowNumber}:\\s*${escapeRegex(scenarioName)}$`
        )
        return filters
      }
    }
    // No row number - use plain name filter
    if (specArg) {
      filters.push('--spec', specArg)
    }
    filters.push('--cucumberOpts.name', payload.fullTitle.trim())
    return filters
  }

  // Suite-level rerun
  if (specArg) {
    filters.push('--spec', specArg)
  }
  return filters
})

FRAMEWORK_FILTERS.set('mocha', ({ specArg, payload }) => {
  const filters: string[] = []
  if (specArg) {
    filters.push('--spec', specArg)
  }
  // For both tests and suites, use grep to filter
  if (payload.fullTitle) {
    filters.push('--mochaOpts.grep', payload.fullTitle)
  }
  return filters
})

FRAMEWORK_FILTERS.set('jasmine', ({ specArg, payload }) => {
  const filters: string[] = []
  if (specArg) {
    filters.push('--spec', specArg)
  }
  // For both tests and suites, use grep to filter
  if (payload.fullTitle) {
    filters.push('--jasmineOpts.grep', payload.fullTitle)
  }
  return filters
})

// Nightwatch CLI: positional spec file + optional --testcase filter
FRAMEWORK_FILTERS.set('nightwatch', ({ specArg, payload }) => {
  const filters: string[] = []
  if (specArg) {
    // Nightwatch doesn't support file:line — strip any trailing line number
    filters.push(specArg.split(':')[0])
  }
  if (payload.entryType === 'test' && payload.label) {
    filters.push('--testcase', payload.label)
  }
  return filters
})

// Nightwatch + Cucumber: feature files are resolved via the config's feature_path.
// Never pass .feature files as positional args — Nightwatch rejects them.
// Nightwatch forwards --name and --tags to the underlying Cucumber runner.
FRAMEWORK_FILTERS.set('nightwatch-cucumber', ({ payload }) => {
  const filters: string[] = []

  // Only pass --name for scenario-level reruns. Feature/file-level suites
  // (suiteType === 'feature') run all their scenarios, so no --name filter.
  const isFeatureLevel = payload.suiteType === 'feature' || payload.runAll
  if (!isFeatureLevel && payload.fullTitle) {
    // Wrap as an anchored exact regex so "Scenario A" never also matches
    // "Scenario A-1" (Cucumber treats --name as a regex).
    const escaped = escapeRegex(payload.fullTitle)
    filters.push('--name', `^${escaped}$`)
  }
  return filters
})

const DEFAULT_FILTERS: FilterBuilder = ({ specArg }) =>
  specArg ? ['--spec', specArg] : []

/**
 * Resolve the filter builder for a given runner, falling back to spec-only.
 *
 * Takes `string | undefined` (not `TestRunnerId`) so callers can pass the
 * raw HTTP-payload value without a cast — the lookup is validated against
 * the Map's keys at runtime, which closes CodeQL's
 * `unvalidated-dynamic-method-call` finding at the call boundary.
 */
export function getFilterBuilder(runnerId: string | undefined): FilterBuilder {
  if (!runnerId) {
    return DEFAULT_FILTERS
  }
  // Map.get on a string key is prototype-safe, and constraining the result
  // to known TestRunnerId entries keeps untrusted input from dispatching
  // to unexpected targets.
  const entry = FRAMEWORK_FILTERS.get(runnerId as TestRunnerId)
  return entry ?? DEFAULT_FILTERS
}
