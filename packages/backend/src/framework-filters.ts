import type { RunnerRequestBody } from '@wdio/devtools-shared'

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export type FilterBuilder = (ctx: {
  specArg?: string
  payload: RunnerRequestBody
}) => string[]

// Each runner's filter builder is a named const — `getFilterBuilder` dispatches
// via an explicit `switch` over the (untrusted) runner-id string instead of a
// table lookup. This closes CodeQL's `unvalidated-dynamic-method-call`
// finding: the call site sees a closed set of statically-known callables.

const buildCucumberFilters: FilterBuilder = ({ specArg, payload }) => {
  const filters: string[] = []

  // Feature-level suites run the entire feature file
  if (payload.suiteType === 'feature' && specArg) {
    const featureFile = specArg.split(':')[0]
    filters.push('--spec', featureFile)
    return filters
  }

  // Priority 1: feature file with line number for exact scenario targeting
  // (works for examples). Note: Cucumber scenarios are type 'suite', not 'test'.
  if (payload.featureFile && payload.featureLine) {
    filters.push('--spec', `${payload.featureFile}:${payload.featureLine}`)
    return filters
  }

  // Priority 2: specific test reruns with an example row number use an
  // exact regex match.
  if (payload.entryType === 'test' && payload.fullTitle) {
    // Cucumber fullTitle format: "1: Scenario name" or "2: Scenario name".
    // Avoid ReDoS by removing ambiguous \s* before .* — use string ops instead.
    const colonIndex = payload.fullTitle.indexOf(':')
    if (colonIndex > 0) {
      const rowNumber = payload.fullTitle.substring(0, colonIndex)
      const scenarioName = payload.fullTitle.substring(colonIndex + 1).trim()
      if (/^\d+$/.test(rowNumber)) {
        if (specArg) {
          filters.push('--spec', specArg)
        }
        filters.push(
          '--cucumberOpts.name',
          `^${rowNumber}:\\s*${escapeRegex(scenarioName)}$`
        )
        return filters
      }
    }
    // No row number — plain name filter
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
}

const buildMochaFilters: FilterBuilder = ({ specArg, payload }) => {
  const filters: string[] = []
  if (specArg) {
    filters.push('--spec', specArg)
  }
  if (payload.fullTitle) {
    filters.push('--mochaOpts.grep', payload.fullTitle)
  }
  return filters
}

const buildJasmineFilters: FilterBuilder = ({ specArg, payload }) => {
  const filters: string[] = []
  if (specArg) {
    filters.push('--spec', specArg)
  }
  if (payload.fullTitle) {
    filters.push('--jasmineOpts.grep', payload.fullTitle)
  }
  return filters
}

// Nightwatch CLI: positional spec file + optional --testcase filter
const buildNightwatchFilters: FilterBuilder = ({ specArg, payload }) => {
  const filters: string[] = []
  if (specArg) {
    // Nightwatch doesn't support file:line — strip any trailing line number
    filters.push(specArg.split(':')[0])
  }
  if (payload.entryType === 'test' && payload.label) {
    filters.push('--testcase', payload.label)
  }
  return filters
}

// Nightwatch + Cucumber: feature files are resolved via the config's
// feature_path. Never pass .feature files as positional args — Nightwatch
// rejects them. Nightwatch forwards --name and --tags to underlying Cucumber.
const buildNightwatchCucumberFilters: FilterBuilder = ({ payload }) => {
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
}

const DEFAULT_FILTERS: FilterBuilder = ({ specArg }) =>
  specArg ? ['--spec', specArg] : []

/**
 * Resolve the filter builder for a given runner, falling back to spec-only.
 *
 * Takes `string | undefined` (not `TestRunnerId`) so callers can pass the
 * raw HTTP-payload value without a cast. The switch enumerates every
 * supported runner explicitly — closes CodeQL's
 * `js/unvalidated-dynamic-method-call` finding at the call site.
 */
export function getFilterBuilder(runnerId: string | undefined): FilterBuilder {
  switch (runnerId) {
    case 'cucumber':
      return buildCucumberFilters
    case 'mocha':
      return buildMochaFilters
    case 'jasmine':
      return buildJasmineFilters
    case 'nightwatch':
      return buildNightwatchFilters
    case 'nightwatch-cucumber':
      return buildNightwatchCucumberFilters
    default:
      return DEFAULT_FILTERS
  }
}
