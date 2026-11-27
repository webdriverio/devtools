import { parseCallSource } from '@wdio/devtools-shared'
import { clipText } from './budget.js'
import { MAX_SOURCE_LINE_CHARS } from './constants.js'

/** The numbered lines around a call site, `>` marking its own line; undefined when the trace holds no such file or line. */
export function sourceAround(
  sources: Readonly<Record<string, string>>,
  callSource: string,
  contextLines: number,
  lineChars = MAX_SOURCE_LINE_CHARS
): string[] | undefined {
  const site = parseCallSource(callSource)
  const text = site ? sources[site.file] : undefined
  if (!site || text === undefined) {
    return undefined
  }
  const lines = text.split(/\r?\n/)
  if (site.line < 1 || site.line > lines.length) {
    return undefined
  }
  const first = Math.max(1, site.line - contextLines)
  const last = Math.min(lines.length, site.line + contextLines)
  const width = String(last).length
  return lines.slice(first - 1, last).map((line, at) => {
    const number = first + at
    const marker = number === site.line ? '>' : ' '
    const code = clipText(line, lineChars)
    return `${marker}${String(number).padStart(width)} | ${code}`.trimEnd()
  })
}
