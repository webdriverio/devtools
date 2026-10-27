/** Where a row says the user's code issued it, as `CommandLog.callSource` encodes it. */
export interface CallSite {
  file: string
  line: number
}

/** Split a call source into its file and 1-based line.
 *  Anchors the line/column at the end so Windows drive paths (`C:\a.ts:10`)
 *  survive. Returns null when there's no trailing line number. */
export function parseCallSource(callSource: string): CallSite | null {
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
