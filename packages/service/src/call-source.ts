import type { parse } from 'stack-trace'

type StackFrame = ReturnType<typeof parse>[number]

/** `<file>:<line>:<column>` from a parsed stack frame; strips file:// and query. */
export function resolveCallSourceFromFrame(
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
  if (absPath === undefined) {
    return undefined
  }
  const line = frame.getLineNumber() ?? undefined
  const column = frame.getColumnNumber() ?? undefined
  return `${absPath}:${line ?? 0}:${column ?? 0}`
}
