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

/** The page URL a command's screenshot shows. A navigation command changes the
 *  page — the new URL only appears in the mutation stream *after* the command's
 *  timestamp, so use its destination argument; every other command runs on the
 *  page already active at its time. */
export function commandPageUrl(
  command: CommandLog,
  mutations: TraceMutation[]
): string | undefined {
  if (commandCategory(command.command) === 'navigation') {
    const target = command.args?.[0]
    if (typeof target === 'string' && ABSOLUTE_URL.test(target)) {
      return target
    }
  }
  return urlAtTimestamp(mutations, command.timestamp)
}
