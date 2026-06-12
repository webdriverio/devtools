import type { TestStatus } from '@wdio/devtools-shared'
import type { TestEntry } from './types.js'

/** Flatten a tree entry to the labels searched by the text filter: a leaf
 *  contributes its own label, a suite contributes its descendants' labels. */
export function getSearchableLabel(entry: TestEntry): string[] {
  if (entry.children.length === 0) {
    return [entry.label]
  }
  return entry.children.flatMap(getSearchableLabel)
}

/**
 * Decide whether a tree entry survives the active filters. Children are
 * filtered before their parent, so a suite that still has children kept its
 * matching descendants and stays visible to keep them reachable — only leaves
 * are matched against the status directly.
 */
export function entryPassesFilter(
  entry: TestEntry,
  query: string,
  status: TestStatus | null
): boolean {
  const queryMatches =
    !query ||
    getSearchableLabel(entry)
      .join(' ')
      .toLowerCase()
      .includes(query.toLowerCase())
  if (!queryMatches) {
    return false
  }
  if (!status) {
    return true
  }
  if (entry.children.length > 0) {
    return true
  }
  return entry.state === status
}
