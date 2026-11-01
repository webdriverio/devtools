import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse as parseStackTrace } from 'stacktrace-parser'

/** The root `package.json` name that identifies this monorepo's checkout. */
const WORKSPACE_ROOT_NAME = 'devtools-monorepo'

/** This monorepo's `packages/` dir when `fromDir` is inside its checkout; undefined for an installed or user-bundled copy. */
export function findOwnPackagesDir(fromDir: string): string | undefined {
  for (let dir = fromDir; ; dir = path.dirname(dir)) {
    if (existsSync(path.join(dir, 'pnpm-workspace.yaml'))) {
      return readPackageName(dir) === WORKSPACE_ROOT_NAME
        ? path.join(dir, 'packages')
        : undefined
    }
    if (path.dirname(dir) === dir) {
      return undefined
    }
  }
}

function readPackageName(dir: string): string | undefined {
  try {
    const pkg = JSON.parse(
      readFileSync(path.join(dir, 'package.json'), 'utf8')
    ) as { name?: unknown }
    return typeof pkg.name === 'string' ? pkg.name : undefined
  } catch {
    return undefined
  }
}

let ownPackagesDir: string | null | undefined

function resolveOwnPackagesDir(): string | undefined {
  if (ownPackagesDir === undefined) {
    try {
      ownPackagesDir =
        findOwnPackagesDir(path.dirname(fileURLToPath(import.meta.url))) ?? null
    } catch {
      ownPackagesDir = null
    }
  }
  return ownPackagesDir ?? undefined
}

/** A file under `<packagesDir>/<package>/src/`, which a source-mapped stack (tsx, vitest) names in place of dist/. */
export function isPackageSource(
  file: string,
  packagesDir: string | undefined
): boolean {
  if (!packagesDir) {
    return false
  }
  try {
    const filePath = file.startsWith('file://') ? fileURLToPath(file) : file
    const relative = path.relative(packagesDir, filePath)
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      return false
    }
    return relative.split(path.sep)[1] === 'src'
  } catch {
    return false
  }
}

/**
 * Return true if a stack frame belongs to user code (not dependencies, Node
 * internals, build output, this monorepo's own sources, or a generic
 * `index.js` entry point).
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
    !file.endsWith('/index.js') &&
    !isPackageSource(file, resolveOwnPackagesDir())
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

/** A user call site, or none at all when no frame on the stack is user code. */
export type CallSourceInfo =
  | { filePath: string; callSource: string }
  | { filePath: undefined; callSource: undefined }

const NO_CALL_SOURCE: CallSourceInfo = {
  filePath: undefined,
  callSource: undefined
}

/**
 * Capture `{ filePath, callSource }` for the first user-code frame on the
 * stack. `callSource` is `<file>:<line>` for the UI's source-location displays;
 * both are undefined when no user frame can be found. `stack` defaults to the
 * live stack; callers with a pre-captured stack (e.g. the assert wrapper) pass
 * it so the frame offsets line up.
 */
export function getCallSourceFromStack(
  stack: string | undefined = new Error().stack
): CallSourceInfo {
  if (!stack) {
    return NO_CALL_SOURCE
  }
  try {
    const frame = parseStackTrace(stack).find(isUserCodeFrame)
    if (!frame?.file) {
      return NO_CALL_SOURCE
    }
    const filePath = normalizeFilePath(frame.file)
    return { filePath, callSource: `${filePath}:${frame.lineNumber ?? 0}` }
  } catch {
    return NO_CALL_SOURCE
  }
}
