import { parse as parseStackTrace } from 'stacktrace-parser'

/**
 * Return true if a stack frame belongs to user code (not dependencies, Node
 * internals, build output, or a generic `index.js` entry point).
 */
export function isUserCodeFrame(frame: {
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

/**
 * Strip the `file://` protocol, any trailing `:line:col` suffix, and
 * percent-decode the result. Node's ESM stack traces use file:// URLs which
 * URL-encode spaces — without decoding, `fs.readFile` hits ENOENT on any
 * path that contains one. Falls back to the literal path if decoding fails.
 */
export function normalizeFilePath(filePath: string): string {
  const stripped = filePath.replace(/^file:\/\//, '').split(':')[0]
  try {
    return decodeURIComponent(stripped)
  } catch {
    return stripped
  }
}

/**
 * Capture `{ filePath, callSource }` for the first user-code frame on the
 * current stack. `callSource` is `<file>:<line>` for the UI's source-location
 * displays; returns `'unknown:0'` (and `undefined` filePath) when no user
 * frame can be found.
 */
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
