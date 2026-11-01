/**
 * The app's single answer to "how far into the timeline did this happen?". Four
 * views badge that offset — the flat actions list, the player's action tree, the
 * player's timeline strip and the dashboard's keyboard navigation — and each used
 * to derive it inline, so the same action could read differently depending on
 * which one announced it.
 *
 * The series an entry is timed against stays the caller's choice, because the
 * views legitimately present different lists. The flat actions list renders
 * document loads as rows of its own, so it measures the MERGED list: a
 * commands-only baseline would print a negative offset for a document load that
 * precedes the first command, which is routine — a command's timestamp is when it
 * ENDED, and a navigation's DOM is captured before `url` returns. Tree mode has
 * no mutation rows, and the timeline strip and keyboard navigation carry no
 * mutation stream at all, so all three measure the commands. What must not differ
 * is the arithmetic, and that lives here.
 *
 * A player's window ORIGIN is a different concept: the timeline strip's window
 * also spans captured frames, which start before the first command, so its origin
 * sits earlier than any baseline here. Measuring an elapsed badge from that origin
 * is what made the same action read 780ms in the strip and 380ms in the actions
 * list — the frames are rows in no list, so no pane ever displayed that offset.
 */

/** Anything on a timeline: a captured command, a DOM mutation, a frame. */
export interface TimedEntry {
  timestamp: number
}

/**
 * Wall clock a series is measured from — its earliest entry, whatever order the
 * entries arrived in. Capture order is not timeline order (a replayed slice or a
 * reversed reader hands the views either), so taking the first element would
 * make the baseline depend on delivery order and badge negative offsets.
 * `undefined` for an empty series: there is no clock to measure against, and 0
 * would read as the epoch.
 */
export function timelineStart(
  entries: readonly TimedEntry[]
): number | undefined {
  let start: number | undefined
  for (const entry of entries) {
    if (start === undefined || entry.timestamp < start) {
      start = entry.timestamp
    }
  }
  return start
}

/**
 * How far into its series an entry sits. An entry timed against nothing — an
 * empty series — is its own baseline and reads zero, rather than leaking a
 * wall-clock timestamp into a duration badge.
 */
export function elapsedSince(
  entries: readonly TimedEntry[],
  entry: TimedEntry
): number {
  return entry.timestamp - (timelineStart(entries) ?? entry.timestamp)
}
