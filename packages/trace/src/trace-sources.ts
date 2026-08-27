// Source files and per-action call stacks for the trace: sources are written
// as path-addressed `src@<sha1(path)>.txt` resources, and each action's
// captured `<file>:<line>[:<column>]` callSource becomes an inline stack frame.

import { sha1Hex } from './sha1.js'
import type { TraceZipResource } from './trace-zip-writer.js'

export interface StackFrame {
  file: string
  line: number
  column: number
}

// Test files are small; anything bigger is generated/bundled and not worth shipping.
const MAX_SOURCE_BYTES = 2 * 1024 * 1024

export function sourceResourceName(filePath: string): string {
  return `src@${sha1Hex(filePath)}.txt`
}

// Splits one trailing `:<digits>` segment; `sep <= 0` keeps Windows drive
// letters (`C:...`) and colon-less paths intact.
function splitNumericSuffix(value: string): { rest: string; num?: number } {
  const sep = value.lastIndexOf(':')
  if (sep <= 0) {
    return { rest: value }
  }
  const digits = value.slice(sep + 1)
  if (!/^\d+$/.test(digits)) {
    return { rest: value }
  }
  return { rest: value.slice(0, sep), num: Number(digits) }
}

/** Inline stack from a captured `<file>:<line>[:<column>]` callSource. */
export function callSourceToStack(
  callSource?: string
): StackFrame[] | undefined {
  if (!callSource || callSource === 'unknown:0') {
    return undefined
  }
  const last = splitNumericSuffix(callSource)
  if (last.num === undefined) {
    return [{ file: callSource, line: 0, column: 0 }]
  }
  const prev = splitNumericSuffix(last.rest)
  if (prev.num === undefined) {
    return [{ file: last.rest, line: last.num, column: 0 }]
  }
  return [{ file: prev.rest, line: prev.num, column: last.num }]
}

export function buildSourceResources(
  sources: Record<string, string>
): TraceZipResource[] {
  const out: TraceZipResource[] = []
  for (const [filePath, text] of Object.entries(sources)) {
    const data = Buffer.from(text, 'utf8')
    if (data.byteLength > MAX_SOURCE_BYTES) {
      continue
    }
    out.push({ resourceName: sourceResourceName(filePath), data })
  }
  return out
}
