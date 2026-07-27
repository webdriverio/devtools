import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Roots resolved from this file's location so the harness works regardless of
// the process cwd (vitest, tsx regen, or a CI runner).
export const TEST_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..'
)
export const REPO_ROOT = path.resolve(TEST_ROOT, '..')

/** Committed golden trace for an entry: `test/fixtures/<id>/trace.zip`. */
export function fixtureTrace(id: string): string {
  return path.join(TEST_ROOT, 'fixtures', id, 'trace.zip')
}

/** Recorded live event stream for an entry (Phase 1b). */
export function fixtureLiveEvents(id: string): string {
  return path.join(TEST_ROOT, 'fixtures', id, 'live-events.json')
}
