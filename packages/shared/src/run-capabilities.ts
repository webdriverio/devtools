import type { Metadata, RunCapabilities, RunnerOptions } from './types.js'

/** What the dashboard offers when an adapter declares nothing. */
export const DEFAULT_CAPABILITIES: RunCapabilities = {
  canRunSuites: true,
  canRunTests: true,
  canRunAll: true
}

// A Gherkin step has no CLI filter of its own, so a Cucumber runner reruns scenarios and features only.
const CUCUMBER_CAPABILITIES: RunCapabilities = {
  canRunSuites: true,
  canRunTests: false,
  canRunAll: true
}

/** Per-runner defaults where they differ from DEFAULT_CAPABILITIES, keyed by the lower-cased runner id. */
export const FRAMEWORK_CAPABILITIES: Record<string, RunCapabilities> = {
  cucumber: CUCUMBER_CAPABILITIES,
  'nightwatch-cucumber': CUCUMBER_CAPABILITIES
}

const runnerOptionsOf = (metadata: Metadata | undefined) =>
  metadata?.options as RunnerOptions | undefined

/** The runner that recorded a stream: `Metadata.runner`, else the same fact under its older name, `options.framework`. */
export function runnerOf(metadata: Metadata | undefined): string | undefined {
  return metadata?.runner ?? runnerOptionsOf(metadata)?.framework
}

/** The run controls a session gets: what it declared over the defaults, else its runner's defaults. */
export function resolveRunCapabilities(
  metadata: Metadata | undefined
): RunCapabilities {
  const declared = runnerOptionsOf(metadata)?.runCapabilities
  if (declared) {
    return { ...DEFAULT_CAPABILITIES, ...declared }
  }
  return (
    FRAMEWORK_CAPABILITIES[runnerOf(metadata)?.toLowerCase() ?? ''] ||
    DEFAULT_CAPABILITIES
  )
}
