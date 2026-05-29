import * as net from 'node:net'
import { parse as parseStackTrace } from 'stacktrace-parser'
import logger from '@wdio/logger'

const log = logger('@wdio/selenium-devtools:utils')

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

function isUserCodeFrame(frame: {
  file?: string | null
}): frame is { file: string } {
  const { file } = frame
  return !!(
    file &&
    !file.includes('/node_modules/') &&
    !file.includes('<anonymous>') &&
    !file.includes('node:internal') &&
    !file.includes('/dist/') &&
    !file.endsWith('/index.js')
  )
}

function normalizeFilePath(filePath: string): string {
  // Node's stack traces in ESM use file:// URLs, which URL-encode spaces and
  // other characters. Strip the prefix, drop the line:col suffix, and decode
  // — otherwise `fs.readFile` hits ENOENT on any path containing a space.
  const stripped = filePath.replace(/^file:\/\//, '').split(':')[0]
  try {
    return decodeURIComponent(stripped)
  } catch {
    // Malformed percent-encoding — keep the literal path rather than throw.
    return stripped
  }
}

export function getCallSourceFromStack(): {
  filePath: string | undefined
  callSource: string
} {
  const stack = new Error().stack
  if (!stack) {
    return { filePath: undefined, callSource: 'unknown:0' }
  }

  const frame = parseStackTrace(stack).find(isUserCodeFrame)
  if (!frame?.file) {
    return { filePath: undefined, callSource: 'unknown:0' }
  }

  const filePath = normalizeFilePath(frame.file)
  return { filePath, callSource: `${filePath}:${frame.lineNumber ?? 0}` }
}

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

export function isPortInUse(port: number, hostname: string): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer()
    server.once('error', () => resolve(true))
    server.once('listening', () => server.close(() => resolve(false)))
    server.listen(port, hostname)
  })
}

export async function findFreePort(
  startPort: number,
  hostname: string
): Promise<number> {
  let port = startPort
  while (await isPortInUse(port, hostname)) {
    log.warn(`Port ${port} is in use, trying ${port + 1}...`)
    port++
  }
  return port
}

/**
 * Capture the command line that launched the current process so the UI's
 * "rerun" button can re-execute the same script. Falls back to the raw
 * argv when npm script context is unavailable.
 */
/** Derive a human-readable request type from URL and MIME type. */
export function getRequestType(url: string, mimeType?: string): string {
  const contentType = mimeType?.toLowerCase() ?? ''
  const urlLower = url.toLowerCase()
  if (contentType.includes('text/html')) {
    return 'document'
  }
  if (contentType.includes('text/css')) {
    return 'stylesheet'
  }
  if (
    contentType.includes('javascript') ||
    contentType.includes('ecmascript')
  ) {
    return 'script'
  }
  if (contentType.includes('image/')) {
    return 'image'
  }
  if (contentType.includes('font/') || contentType.includes('woff')) {
    return 'font'
  }
  if (contentType.includes('application/json')) {
    return 'fetch'
  }
  if (urlLower.endsWith('.html') || urlLower.endsWith('.htm')) {
    return 'document'
  }
  if (urlLower.endsWith('.css')) {
    return 'stylesheet'
  }
  if (urlLower.endsWith('.js') || urlLower.endsWith('.mjs')) {
    return 'script'
  }
  if (/\.(png|jpg|jpeg|gif|svg|webp|ico)$/.test(urlLower)) {
    return 'image'
  }
  if (/\.(woff|woff2|ttf|eot|otf)$/.test(urlLower)) {
    return 'font'
  }
  return 'xhr'
}

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
