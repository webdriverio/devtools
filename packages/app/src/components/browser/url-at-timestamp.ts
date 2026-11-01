import type { CommandLog, TraceMutation } from '@wdio/devtools-shared'

import { commandCategory } from '../workbench/actionItems/category.js'

const ABSOLUTE_URL = /^https?:\/\//

/** The page URL captured at or before `timestamp` — the most recent navigation
 *  in the mutation stream up to that point. Commands carry no URL of their own,
 *  so the address bar uses this to follow command selection in snapshot mode. */
export function urlAtTimestamp(
  mutations: TraceMutation[],
  timestamp: number
): string | undefined {
  let url: string | undefined
  let best = -Infinity
  for (const mutation of mutations) {
    if (
      mutation.url &&
      mutation.timestamp <= timestamp &&
      mutation.timestamp >= best
    ) {
      best = mutation.timestamp
      url = mutation.url
    }
  }
  return url
}

/** First argument of a navigation command when it's an absolute URL — `url`,
 *  `navigateTo` etc. carry their destination there. */
function navigationTarget(command: CommandLog): string | undefined {
  if (commandCategory(command.command) !== 'navigation') {
    return undefined
  }
  const target = command.args?.[0]
  return typeof target === 'string' && ABSOLUTE_URL.test(target)
    ? target
    : undefined
}

/** The page URL a command's screenshot shows: the destination of the most
 *  recent navigation command at or before it (the command itself when it
 *  navigates). The command stream is authoritative — unlike the DOM mutation
 *  stream it captures every navigation even on pages that block DOM capture —
 *  so mutations are only a fallback for traces without command navigations. */
export function commandPageUrl(
  command: CommandLog,
  commands: CommandLog[],
  mutations: TraceMutation[]
): string | undefined {
  let url: string | undefined
  let best = -Infinity
  for (const candidate of commands) {
    if (candidate.timestamp > command.timestamp || candidate.timestamp < best) {
      continue
    }
    const target = navigationTarget(candidate)
    if (target) {
      best = candidate.timestamp
      url = target
    }
  }
  return url ?? urlAtTimestamp(mutations, command.timestamp)
}
