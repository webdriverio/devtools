// Console helpers come from @wdio/devtools-core. `stripAnsiCodes` is the
// local name kept for backwards compatibility with existing import sites.
export {
  stripAnsi as stripAnsiCodes,
  detectLogLevel,
  createConsoleLogEntry
} from '@wdio/devtools-core'

export { chromeLogLevelToLogLevel } from '@wdio/devtools-core'

export {
  generateStableUid,
  deterministicUid,
  resetSignatureCounters
} from '@wdio/devtools-core'

export { getCallSourceFromStack } from '@wdio/devtools-core'

// Source-scan for `it/test/specify('title', ...)` (or `describe/context/suite`
// when kind='suite'). Stack-walking from inside the runner's beforeEach
// hooks doesn't reach the user's test body.
import * as fs from 'node:fs'

export function findTestLineInFile(
  filePath: string,
  title: string,
  kind: 'test' | 'suite' = 'test'
): number | null {
  try {
    if (!fs.existsSync(filePath)) {
      return null
    }
    const lines = fs.readFileSync(filePath, 'utf-8').split('\n')
    const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const keywords =
      kind === 'suite' ? 'describe|context|suite' : 'it|test|specify'
    const re = new RegExp(`\\b(?:${keywords})\\s*\\(\\s*['"\`]${escaped}['"\`]`)
    for (let i = 0; i < lines.length; i++) {
      if (re.test(lines[i])) {
        return i + 1
      }
    }
  } catch {
    /* ignore — fall back to file:0 */
  }
  return null
}

export { isPortInUse, findFreePort } from '@wdio/devtools-core'

/**
 * Capture the command line that launched the current process so the UI's
 * "rerun" button can re-execute the same script. Falls back to the raw
 * argv when npm script context is unavailable.
 */
/** Derive a human-readable request type from URL and MIME type. */
export { getRequestType } from '@wdio/devtools-core'

export function captureLaunchCommand(): string {
  const npmScript = process.env.npm_lifecycle_event
  const npmConfigUserAgent = process.env.npm_config_user_agent ?? ''
  if (npmScript) {
    const tool = npmConfigUserAgent.startsWith('pnpm')
      ? 'pnpm'
      : npmConfigUserAgent.startsWith('yarn')
        ? 'yarn'
        : 'npm'
    return tool === 'npm' ? `npm run ${npmScript}` : `${tool} ${npmScript}`
  }
  return [process.argv0, ...process.argv.slice(1)].join(' ')
}
