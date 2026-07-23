import type { CommandLog } from '@wdio/devtools-shared'

// TraceMutation is the browser-side global from packages/script/types.d.ts
// (its addedNodes carry SimplifiedVNodes) — the same type the snapshot player
// stores; using the shared Node-side TraceMutation here would not be
// assignable back into the player's global-typed render methods.

/** The DOM state a command left behind — i.e. its RESULT, not the page it
 *  started from. A navigating click's destination DOM is captured a few ms
 *  AFTER the click's own endTime (the mutation timestamp trails the command),
 *  so anchoring on the command's own timestamp shows the PRE-command page
 *  (click "Login" → the login page instead of the secure area). Bound instead
 *  by the NEXT command's start: the last mutation before the next command
 *  begins is the state this command produced. The final command has no upper
 *  bound and uses the last captured DOM. Falls back to the first mutation when
 *  every mutation is later (command precedes the slice's initial full-DOM). */
export function mutationForCommand(
  command: CommandLog | undefined,
  commands: CommandLog[],
  mutations: TraceMutation[]
): TraceMutation | undefined {
  if (!command?.timestamp || !mutations.length) {
    return undefined
  }
  const idx = commands.indexOf(command)
  const next = idx >= 0 ? commands[idx + 1] : undefined
  const upperBound = next?.startTime ?? next?.timestamp ?? Infinity
  let best: TraceMutation | undefined
  for (const mutation of mutations) {
    if (mutation.timestamp < upperBound) {
      best = mutation
    } else {
      break
    }
  }
  return best ?? mutations[0]
}
