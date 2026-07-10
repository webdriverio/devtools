// Trace-slice flushing for the WDIO adapter: previous-slice flush at boundary
// changes plus the eager per-test flush. Kept out of index.ts so the slice
// selection and flush I/O are unit-testable and the god-file stays lean.

import {
  flushRangeLogged,
  type SpecRange,
  type TraceExportContext
} from '@wdio/devtools-core'

/** The range for the test that just ended is the most recent slice recorded
 *  under this base testUid — retries push a new range under the same testUid,
 *  so reverse-scanning finds the attempt whose afterTest is now firing. */
export function findCurrentTestRange(
  ranges: readonly SpecRange[],
  testUid: string
): SpecRange | undefined {
  for (let i = ranges.length - 1; i >= 0; i--) {
    if (ranges[i]!.testUid === testUid) {
      return ranges[i]
    }
  }
  return undefined
}

/** Fire-and-forget flush of the previous unflushed slice at a boundary change
 *  (spec granularity, or a test slice whose eager flush was missed). Errors are
 *  logged, never thrown, so a failed flush can't abort the next test. */
export function flushPrevSlice(
  ctx: TraceExportContext,
  range: SpecRange
): void {
  void flushRangeLogged(ctx, range)
}

/** Awaited flush of the just-ended test's slice (test granularity), so this
 *  attempt's just-stamped metadata is written before a retry's beforeTest
 *  overwrites the entry. No-op when the test recorded no range. */
export async function flushTestSlice(
  ctx: TraceExportContext,
  ranges: readonly SpecRange[],
  testUid: string
): Promise<void> {
  const range = findCurrentTestRange(ranges, testUid)
  if (!range) {
    return
  }
  await flushRangeLogged(ctx, range)
}
