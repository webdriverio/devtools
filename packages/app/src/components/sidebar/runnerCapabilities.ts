/**
 * Pure derivations from the runner metadata. Used by the sidebar explorer
 * (and tests) to decide whether the Run/Rerun buttons should be enabled.
 * Extracted from explorer.ts so the Lit component stays under the
 * file-size cap.
 */

import type { Metadata } from '@wdio/devtools-shared'
import type {
  RunCapabilities,
  RunnerOptions,
  TestEntry,
  TestRunDetail
} from './types.js'
import { DEFAULT_CAPABILITIES, FRAMEWORK_CAPABILITIES } from './constants.js'

export function getRunnerOptions(
  metadata: Metadata | undefined
): RunnerOptions | undefined {
  return metadata?.options as RunnerOptions | undefined
}

export function getFramework(
  metadata: Metadata | undefined
): string | undefined {
  return getRunnerOptions(metadata)?.framework
}

export function getRunCapabilities(
  metadata: Metadata | undefined
): RunCapabilities {
  const options = getRunnerOptions(metadata)
  if (options?.runCapabilities) {
    return { ...DEFAULT_CAPABILITIES, ...options.runCapabilities }
  }
  const framework = options?.framework?.toLowerCase() ?? ''
  return FRAMEWORK_CAPABILITIES[framework] || DEFAULT_CAPABILITIES
}

export function isRunDisabled(
  metadata: Metadata | undefined,
  entry: TestEntry
): boolean {
  const caps = getRunCapabilities(metadata)
  if (entry.type === 'test' && !caps.canRunTests) {
    return true
  }
  if (entry.type === 'suite' && !caps.canRunSuites) {
    return true
  }
  return false
}

export function isRunDisabledDetail(
  metadata: Metadata | undefined,
  detail: TestRunDetail
): boolean {
  const caps = getRunCapabilities(metadata)
  if (detail.entryType === 'test' && !caps.canRunTests) {
    return true
  }
  if (detail.entryType === 'suite' && !caps.canRunSuites) {
    return true
  }
  return false
}

export function getRunDisabledReason(
  metadata: Metadata | undefined,
  entry: TestEntry
): string | undefined {
  if (!isRunDisabled(metadata, entry)) {
    return undefined
  }
  return entry.type === 'test'
    ? 'Single-test execution is not supported by this framework.'
    : 'Suite execution is not supported by this framework.'
}

export function getCapabilityWarning(detail: TestRunDetail): string {
  return detail.entryType === 'test'
    ? 'Single-test execution is not supported by this framework.'
    : 'Suite execution is disabled by this framework.'
}

export function getConfigPath(
  metadata: Metadata | undefined
): string | undefined {
  const options = getRunnerOptions(metadata)
  return options?.configFilePath || options?.configFile
}

export function getRerunCommand(
  metadata: Metadata | undefined
): string | undefined {
  return getRunnerOptions(metadata)?.rerunCommand
}

export function getLaunchCommand(
  metadata: Metadata | undefined
): string | undefined {
  return getRunnerOptions(metadata)?.launchCommand
}
