import type { CommandLog } from '@wdio/devtools-shared'

// TraceMutation is the browser-side global from packages/script/types.d.ts
// (its addedNodes carry SimplifiedVNodes) — the same type the snapshot player
// stores; using the shared Node-side TraceMutation here would not be
// assignable back into the player's global-typed render methods.

/** Timeline position of a command: its issue clock, then the adapter's issue
 *  counter, then its position in the array. The first two are the key
 *  `buildActionEvents` orders the trace by; the array index is the last resort
 *  so a fully-tied pair keeps arrival order (and a chronologically ordered
 *  array — every trace — resolves to its own successor, unchanged). */
type TimelinePosition = readonly [
  start: number,
  sequence: number,
  index: number
]

const positionOf = (command: CommandLog, index: number): TimelinePosition => [
  command.startTime ?? command.timestamp,
  command.sequence ?? 0,
  index
]

const isLater = (a: TimelinePosition, b: TimelinePosition): boolean =>
  a[0] !== b[0] ? a[0] > b[0] : a[1] !== b[1] ? a[1] > b[1] : a[2] > b[2]

/** Start of the command that follows this one ON THE TIMELINE, which is not the
 *  one that follows it in the array: live mode appends commands in ARRIVAL
 *  order, and a deferred row (a Nightwatch native assert, held back until its
 *  outcome is known and flushed in a batch at test-end) arrives long after the
 *  rows it ran between while carrying its real, much earlier start. Reading the
 *  array neighbour then bounded a command by a time before it even ran, and the
 *  replay resolved it to a document several navigations back — measured on the
 *  BDD example, the run's last `waitForElementVisible('#username')` (on /login)
 *  took its bound from an assert that had run 7.6s earlier and replayed
 *  /secure. Traces are exported in timeline order, so there the successor is
 *  the array neighbour and nothing changes. */
function nextCommandStart(command: CommandLog, commands: CommandLog[]): number {
  const idx = commands.indexOf(command)
  if (idx === -1) {
    return Infinity
  }
  const own = positionOf(command, idx)
  let next: TimelinePosition | undefined
  for (let i = 0; i < commands.length; i++) {
    const candidate = positionOf(commands[i], i)
    if (!isLater(candidate, own)) {
      continue
    }
    if (next === undefined || isLater(next, candidate)) {
      next = candidate
    }
  }
  return next ? next[0] : Infinity
}

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
  // `timestamp` is required by the contract and 0 is a real value — the first
  // command of a normalized or standalone trace — so only absence bails out.
  if (command === undefined || !mutations.length) {
    return undefined
  }
  const upperBound = nextCommandStart(command, commands)
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
