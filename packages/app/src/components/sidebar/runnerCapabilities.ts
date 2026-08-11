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
import {
  DEFAULT_CAPABILITIES,
  FRAMEWORK_CAPABILITIES,
  RUN_ALL_REFUSAL,
  RUN_ALL_UID,
  SINGLE_TEST_REFUSAL,
  SUITE_REFUSAL
} from './constants.js'

export function isRunAll(detail: Pick<TestRunDetail, 'uid'>): boolean {
  return detail.uid === RUN_ALL_UID
}

export function getRunnerOptions(
  metadata: Metadata | undefined
): RunnerOptions | undefined {
  return metadata?.options as RunnerOptions | undefined
}

/** The runner that recorded this stream. `Metadata.runner` is the typed carrier;
 *  the untyped `options.framework` is the same fact under an older name, kept as
 *  a fallback so a zip recorded before the field existed — or by a foreign tool
 *  that only wrote the option — still resolves. */
export function getFramework(
  metadata: Metadata | undefined
): string | undefined {
  return metadata?.runner ?? getRunnerOptions(metadata)?.framework
}

export function getRunCapabilities(
  metadata: Metadata | undefined
): RunCapabilities {
  const options = getRunnerOptions(metadata)
  if (options?.runCapabilities) {
    return { ...DEFAULT_CAPABILITIES, ...options.runCapabilities }
  }
  const framework = getFramework(metadata)?.toLowerCase() ?? ''
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
