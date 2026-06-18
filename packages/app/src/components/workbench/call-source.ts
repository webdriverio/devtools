/** Pure helpers for working with a command's `callSource` string.
 *
 *  A call source is `<file>:<line>` or `<file>:<line>:<column>`, produced from
 *  parsed stack traces. The format is identical across every runner/framework
 *  (WebdriverIO, Nightwatch, Selenium), so nothing here branches on framework. */

/** Split a call source into its file and 1-based line.
 *  Anchors the line/column at the end so Windows drive paths (`C:\a.ts:10`)
 *  survive. Returns null when there's no trailing line number. */
export function parseCallSource(
  callSource: string
): { file: string; line: number } | null {
  // Match only the trailing line, with an optional column. Two flat patterns
  // (no nested quantifier) keep it linear and handle Windows drive paths
  // (`C:\a.ts:10`): everything before the matched `:line` is the file.
  const match = callSource.match(/:(\d+):\d+$/) || callSource.match(/:(\d+)$/)
  if (!match || match.index === undefined) {
    return null
  }
  return {
    file: callSource.slice(0, match.index),
    line: parseInt(match[1], 10)
  }
}

/** Last path segment, handling both POSIX (`/`) and Windows (`\`) separators. */
export function fileBasename(path: string): string {
  const segments = path.split(/[/\\]/)
  return segments[segments.length - 1] || path
}

/** Path split into non-empty display segments (POSIX or Windows separators). */
export function pathSegments(path: string): string[] {
  return path.split(/[/\\]/).filter(Boolean)
}
