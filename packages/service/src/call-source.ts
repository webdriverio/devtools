import { parse } from 'stack-trace'

import { SPEC_FRAME_SEARCH_DEPTH } from './constants.js'

type StackFrame = ReturnType<typeof parse>[number]

/**
 * The outermost frame `isSpec` accepts among the frames below the innermost call of `hook`. Read from below the hook
 * so the service's own frames around it never count against the stack limit, which they did once the hooks gained a
 * wrapper: an expect matcher's read lost its spec line, and with it its row.
 */
export function specFrameBelow(
  hook: (...args: never[]) => unknown,
  isSpec: (file: string | null) => boolean
): StackFrame | undefined {
  const probe = new Error('')
  const limit = Error.stackTraceLimit
  Error.stackTraceLimit = SPEC_FRAME_SEARCH_DEPTH
  try {
    Error.captureStackTrace(probe, hook)
  } finally {
    Error.stackTraceLimit = limit
  }
  return parse(probe)
    .reverse()
    .find((frame) => isSpec(frame.getFileName()))
}

/** Absolute file path from a parsed stack frame; strips file:// and query. */
export function resolveFilePathFromFrame(
  frame: StackFrame
): string | undefined {
  const rawFile = frame.getFileName() ?? undefined
  let absPath = rawFile
  if (rawFile?.startsWith('file://')) {
    try {
      absPath = decodeURIComponent(new URL(rawFile).pathname)
    } catch {
      absPath = rawFile
    }
  }
  if (absPath?.includes('?')) {
    absPath = absPath.split('?')[0]
  }
  return absPath
}

/** `<file>:<line>:<column>` from a parsed stack frame; strips file:// and query. */
export function resolveCallSourceFromFrame(
  frame: StackFrame
): string | undefined {
  const absPath = resolveFilePathFromFrame(frame)
  if (absPath === undefined) {
    return undefined
  }
  const line = frame.getLineNumber() ?? undefined
  const column = frame.getColumnNumber() ?? undefined
  return `${absPath}:${line ?? 0}:${column ?? 0}`
}
