/**
 * Pure derivations from the runner metadata. Used by the sidebar explorer
 * (and tests) to decide whether the Run/Rerun buttons should be enabled.
 * Extracted from explorer.ts so the Lit component stays under the
 * file-size cap.
 *
 * Every capability here is about *launching*. Stopping deliberately has none:
 * `POST /api/tests/stop` takes no body and kills whatever child the backend
 * spawned, so no framework varies on it and a `canStop` field would be `true`
 * forever. A run that can be started must always be stoppable.
 */

import type { Metadata } from '@wdio/devtools-shared'
import type {
  RunCapabilities,
  RunnerOptions,
  TestEntry,
  TestRunDetail
} from './types.js'
import { DEFAULT_CAPABILITIES, FRAMEWORK_CAPABILITIES } from './constants.js'

/** The uid the header control names the whole tree with. `RunnerRequestBody`'s
 *  `runAll` flag is derived from it, so it is also the signal that a refusal
 *  has to be judged against `canRunAll` — not against the `canRunSuites` its
 *  `entryType` would otherwise select. */
export const RUN_ALL_UID = '*'

const SINGLE_TEST_REFUSAL =
  'Single-test execution is not supported by this framework.'
const SUITE_REFUSAL = 'Suite execution is not supported by this framework.'
const RUN_ALL_REFUSAL =
  'Running every test at once is not supported by this framework.'

export function isRunAll(detail: Pick<TestRunDetail, 'uid'>): boolean {
  return detail.uid === RUN_ALL_UID
}

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
  // A run-all is not a suite run: it needs the whole-tree entry point the
  // header control is rendered from, which several runners don't have.
  if (isRunAll(detail)) {
    return !caps.canRunAll
  }
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
  return entry.type === 'test' ? SINGLE_TEST_REFUSAL : SUITE_REFUSAL
}

/** Reason the header run-all control is refused, for its tooltip — the only
 *  surface a real user sees, since the button is disabled and never reaches
 *  the handler that logs the warning. */
export function getRunAllDisabledReason(
  metadata: Metadata | undefined
): string | undefined {
  return getRunCapabilities(metadata).canRunAll ? undefined : RUN_ALL_REFUSAL
}

export function getCapabilityWarning(detail: TestRunDetail): string {
  if (isRunAll(detail)) {
    return RUN_ALL_REFUSAL
  }
  return detail.entryType === 'test' ? SINGLE_TEST_REFUSAL : SUITE_REFUSAL
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
