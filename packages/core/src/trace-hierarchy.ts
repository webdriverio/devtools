// The ordered open-group path for a command — outermost first — that the action
// exporter's group stack turns into balanced nested Tracing.tracingGroup
// markers. The path is the test's ancestry (feature/scenario/suite, from the
// suite-metadata walk) + the test itself + its step, when a stepUid is set.

import type { CommandLog, TestMetadataMap } from '@wdio/devtools-shared'

export interface GroupNode {
  uid: string
  title: string
}

export function buildGroupPath(
  cmd: CommandLog,
  testMetadata?: TestMetadataMap
): GroupNode[] {
  const path: GroupNode[] = []
  if (cmd.testUid) {
    const entry = testMetadata?.get(cmd.testUid)
    for (const ancestor of entry?.ancestry ?? []) {
      path.push({ uid: ancestor.uid, title: ancestor.title })
    }
    path.push({ uid: cmd.testUid, title: entry?.title ?? cmd.testUid })
  }
  if (cmd.stepUid) {
    const stepEntry = testMetadata?.get(cmd.stepUid)
    path.push({ uid: cmd.stepUid, title: stepEntry?.title ?? cmd.stepUid })
  }
  return path
}
