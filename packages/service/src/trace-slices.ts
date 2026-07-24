// Trace-slice flushing for the WDIO adapter: previous-slice flush at boundary
// changes plus the eager per-test flush. Kept out of index.ts so the slice
// selection and flush I/O are unit-testable and the god-file stays lean.

import {
  findFlushableRange,
  flushRangeLogged,
  type SpecRange,
  type TraceArtifact,
  type TraceExportContext
} from '@wdio/devtools-core'

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
 *  overwrites the entry. Returns the produced artifact (for same-hook Allure
 *  attach); undefined when the test recorded no range. */
export async function flushTestSlice(
  ctx: TraceExportContext,
  ranges: readonly SpecRange[],
  testUid: string
): Promise<TraceArtifact | undefined> {
  const range = findFlushableRange(ranges, testUid)
  if (!range) {
    return undefined
  }
  return flushRangeLogged(ctx, range)
}
