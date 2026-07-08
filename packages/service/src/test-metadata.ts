// Per-test metadata helpers shared between the before* and after* hooks so the
// state stamp in afterTest/afterScenario lands on the entry beforeTest created.

import { deterministicUid } from '@wdio/devtools-core'
import type { TestMetadataMap, TestStatus } from '@wdio/devtools-shared'

/** Stable per-test key. beforeTest and afterTest derive it identically so keys
 *  match. File-less runners (some non-WDIO frameworks) key on the title alone. */
export function testMetadataUid(
  file: string | undefined,
  title: string
): string {
  return file ? deterministicUid(file, title) : title
}

/** Scenario key that separates scenario-outline example rows: they share a
 *  name, so the pickle's astNodeIds (distinct per row, stable across reruns)
 *  are folded in. beforeScenario and afterScenario derive it identically. */
export function cucumberScenarioUid(
  uri: string,
  name: string,
  astNodeIds?: readonly string[]
): string {
  return astNodeIds?.length
    ? deterministicUid(uri, name, astNodeIds.join(':'))
    : deterministicUid(uri, name)
}

/** Canonical test state from a WDIO afterTest/afterScenario result. */
export function resultToState(result: {
  passed?: boolean
  skipped?: boolean
}): TestStatus {
  if (result.skipped) {
    return 'skipped'
  }
  return result.passed ? 'passed' : 'failed'
}

/** Stamp the final state onto the metadata entry beforeTest/beforeScenario
 *  created, so retention can gate its trace. No-op when there's no entry. */
export function stampTestState(
  metadata: TestMetadataMap,
  uid: string,
  result?: { passed?: boolean; skipped?: boolean }
): void {
  const entry = result && metadata.get(uid)
  if (entry) {
    entry.state = resultToState(result)
  }
}
