import fs from 'fs'
import path from 'node:path'
import { findTestFileFromStack } from './utils.js'

/**
 * Resolve a Nightwatch test's `currentTest.module` to an absolute spec-file
 * path on disk. Priority:
 *   1. Walk the runtime stack for a user frame.
 *   2. A cached path from a previous command on the same browser (browserProxy).
 *   3. Cartesian search across the user's `src_folders` + cwd fallbacks.
 *
 * Used by `beforeEach` to find the file that `extractTestMetadata` should
 * parse for test names + suite/test line numbers. Returns `null` when the
 * file can't be located on disk (source view falls back to "unavailable").
 */
export function resolveSpecFilePath(
  testFile: string,
  modulePath: string | undefined,
  srcFolders: string[],
  cachedPath: string | undefined
): string | null {
  let fullPath: string | null = findTestFileFromStack() || null
  if (!fullPath && cachedPath && cachedPath.includes(testFile)) {
    fullPath = cachedPath
  }
  if (fullPath) {
    return fullPath
  }
  if (!testFile) {
    return null
  }

  const workspaceRoot = process.cwd()
  // `currentTest.module` is relative to a src_folder, e.g. `basic/ecosia`.
  // We try each src_folder + cwd-level fallback. Use `path.resolve` (not
  // `path.join`) so absolute src_folders entries — like
  // `path.resolve(__dirname, 'tests')` from a nightwatch.conf.cjs living
  // outside the package — bypass `workspaceRoot` correctly.
  const normalized = (modulePath || '').replace(/\\/g, '/')
  const srcFolderPaths = srcFolders.flatMap((sf) =>
    normalized
      ? [
          path.resolve(workspaceRoot, sf, normalized + '.js'),
          path.resolve(workspaceRoot, sf, normalized + '.ts'),
          path.resolve(workspaceRoot, sf, normalized + '.cjs'),
          path.resolve(workspaceRoot, sf, normalized)
        ]
      : []
  )
  const possiblePaths = [
    ...srcFolderPaths,
    // Treat module path as relative to cwd (works when src_folders isn't nested)
    ...(normalized
      ? [
          path.resolve(workspaceRoot, normalized + '.js'),
          path.resolve(workspaceRoot, normalized + '.ts'),
          path.resolve(workspaceRoot, normalized + '.cjs'),
          path.resolve(workspaceRoot, normalized)
        ]
      : []),
    path.resolve(workspaceRoot, 'tests', testFile + '.js'),
    path.resolve(workspaceRoot, 'test', testFile + '.js'),
    path.resolve(workspaceRoot, testFile + '.js')
  ]

  for (const candidate of possiblePaths) {
    if (fs.existsSync(candidate)) {
      return candidate
    }
  }
  return null
}
