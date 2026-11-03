import type { ActionSnapshot } from '@wdio/devtools-shared'

/** Frames are screenshot-backed: a url-only capture merged over an earlier record would pair the new url with the old image and DOM. */
export function capturedPageState(snap: ActionSnapshot): boolean {
  return Boolean(snap.screenshot)
}

export interface FinalFrameCommand {
  command: string
  timestamp: number
}

/** Rows after the last capture saw a state no capture holds; the end-of-test capture is stamped at that capture's timestamp so those rows resolve to it. */
export function finalFrameStamp(
  commands: ReadonlyArray<FinalFrameCommand>,
  testStartMs: number,
  lastCapturedTimestamp: number | undefined
): FinalFrameCommand | null {
  const inTest = commands.filter((c) => c.timestamp >= testStartMs)
  const last = inTest[inTest.length - 1]
  if (!last) {
    return null
  }
  if (
    lastCapturedTimestamp === undefined ||
    lastCapturedTimestamp < testStartMs
  ) {
    return { timestamp: last.timestamp, command: last.command }
  }
  if (!inTest.some((c) => c.timestamp > lastCapturedTimestamp)) {
    return null
  }
  const atOrBefore = inTest.filter((c) => c.timestamp <= lastCapturedTimestamp)
  const owner = atOrBefore[atOrBefore.length - 1] ?? inTest[0]!
  return { timestamp: lastCapturedTimestamp, command: owner.command }
}
