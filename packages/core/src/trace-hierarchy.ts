// The ordered open-group path for a command — outermost first — that the action
// exporter's group stack turns into balanced nested Tracing.tracingGroup
// markers. The path is the test's ancestry (feature/scenario/suite, from the
// suite-metadata walk) + the test itself + its step, when a stepUid is set.

import type { CommandLog, TestMetadataMap } from '@wdio/devtools-shared'

export interface GroupNode {
  uid: string
  title: string
}

/** A node's own name, with an enclosing group's title stripped off the front.
 *  Some runners report a test's FULL title (`<suite> <test>`), so nesting it
 *  under its own suite renders the suite name twice. Display only — the entry's
 *  stored title still keys artifacts and slices. Falls back to the full title
 *  when stripping would leave nothing, so a test named after its suite keeps a
 *  label. */
function ownTitle(title: string, parent: GroupNode | undefined): string {
  if (!parent || !title.startsWith(parent.title)) {
    return title
  }
  return title.slice(parent.title.length).trim() || title
}

export function buildGroupPath(
  cmd: CommandLog,
  testMetadata?: TestMetadataMap
): GroupNode[] {
  const path: GroupNode[] = []
  if (cmd.testUid) {
    const entry = testMetadata?.get(cmd.testUid)
    for (const ancestor of entry?.ancestry ?? []) {
      path.push({
        uid: ancestor.uid,
        title: ownTitle(ancestor.title, path[path.length - 1])
      })
    }
    path.push({
      uid: cmd.testUid,
      title: ownTitle(entry?.title ?? cmd.testUid, path[path.length - 1])
    })
  }
  if (cmd.stepUid) {
    const stepEntry = testMetadata?.get(cmd.stepUid)
    path.push({
      uid: cmd.stepUid,
      title: ownTitle(stepEntry?.title ?? cmd.stepUid, path[path.length - 1])
    })
  }
  return path
}
