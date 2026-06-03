import fs from 'node:fs'
import path from 'node:path'

export interface ResolveAdapterOutputDirInput {
  /**
   * Honored as-is if set — used by adapters that expose a user-facing
   * `outputDir` option (e.g. WDIO). Skips all other resolution steps.
   */
  userConfiguredDir?: string
  /**
   * Absolute path to the current test file. When known, the video / trace
   * lands in the same folder as the spec the user just ran. This is the
   * preferred location across adapters.
   */
  testFilePath?: string
  /**
   * Absolute path to the resolved framework config file (wdio.conf.ts,
   * nightwatch.conf.cjs, etc.). Used as a fallback when the test file
   * isn't known.
   */
  configPath?: string
  /** Last-resort fallback. Defaults to `process.cwd()`. */
  fallbackDir?: string
}

const NODE_MODULES_SEGMENT = `${path.sep}node_modules${path.sep}`

function isWritable(dir: string): boolean {
  try {
    fs.accessSync(dir, fs.constants.W_OK)
    return true
  } catch {
    return false
  }
}

/**
 * Resolve the directory where an adapter should write output files
 * (screencast .webm, trace JSON, etc.).
 *
 * Priority:
 *   1. `userConfiguredDir` — explicit opt-in, honored as-is.
 *   2. `dirname(testFilePath)` — same folder as the spec that just ran.
 *   3. `dirname(configPath)` — fallback to the framework config dir.
 *   4. `fallbackDir` (default `process.cwd()`).
 *
 * Any candidate inside a `node_modules/` segment is skipped — this can
 * happen in symlinked workspaces where the test file resolves through a
 * linked dependency. Each candidate must also be writable; non-writable
 * dirs fall through to the next.
 *
 * Shared by all three adapters (service / nightwatch-devtools /
 * selenium-devtools) so the output location stays consistent regardless
 * of where the user invoked the runner from. See CLAUDE.md §2.2.
 */
export function resolveAdapterOutputDir(
  input: ResolveAdapterOutputDirInput = {}
): string {
  const fallback = input.fallbackDir ?? process.cwd()
  // userConfiguredDir bypasses the node_modules and writability filters
  // because the user opted into it explicitly — surprising overrides are
  // worse than failing loudly here.
  if (input.userConfiguredDir) {
    return input.userConfiguredDir
  }
  const candidates: string[] = []
  if (input.testFilePath) {
    candidates.push(path.dirname(input.testFilePath))
  }
  if (input.configPath) {
    candidates.push(path.dirname(input.configPath))
  }
  candidates.push(fallback)
  for (const dir of candidates) {
    if (!dir) {
      continue
    }
    if (dir.includes(NODE_MODULES_SEGMENT)) {
      continue
    }
    if (isWritable(dir)) {
      return dir
    }
  }
  return fallback
}
