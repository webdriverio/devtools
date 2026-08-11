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
 * True when a tracked assert was called DIRECTLY by user code. `stack` MUST be
 * captured inside the `patchedAssert` wrapper (`new Error().stack` on its first
 * line), so frames[0] is the wrapper and frames[1] is whoever called the
 * assert. A non-user immediate caller means a framework/dependency assert fired
 * *during* a user operation (which `getCallSourceFromStack` would otherwise
 * mis-attribute to the far-off user frame and surface as a noisy row) — drop it.
 * Uses the fixed frame offset rather than the wrapper's name, so it survives a
 * bundler minifying/renaming the wrapper. No stack → keep (never lose a real
 * assert to an absent stack).
 */
export function isAssertFromUserCode(stack: string | undefined): boolean {
  if (!stack) {
    return true
  }
  const caller = parseStackTrace(stack)[1]
  return !!caller && isUserCodeFrame(caller)
}

/**
 * Capture `{ filePath, callSource }` for the first user-code frame on the
 * stack. `callSource` is `<file>:<line>` for the UI's source-location displays;
 * returns `'unknown:0'` (and `undefined` filePath) when no user frame can be
 * found. `stack` defaults to the live stack; callers with a pre-captured stack
 * (e.g. the assert wrapper) pass it so the frame offsets line up.
 */
export function getCallSourceFromStack(
  stack: string | undefined = new Error().stack
): {
  filePath: string | undefined
  callSource: string
} {
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
