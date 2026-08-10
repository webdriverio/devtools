// Trace-slice bookkeeping for the WDIO adapter: where a slice boundary falls,
// which slice is flushed when, and the flush I/O itself. Kept out of index.ts
// so the slice selection is unit-testable and the god-file only forwards its
// lifecycle hooks.

import {
  findFlushableRange,
  flushRangeLogged,
  recordSliceBoundary,
  type SpecRange,
  type TraceArtifact,
  type TraceExportContext
} from '@wdio/devtools-core'
import type { SessionCapturer } from './session.js'
import type { ServiceOptions } from './types.js'

/** Live accessors into the owning service's state. The capturer is replaced in
 *  before() and the browser by reloadSession, so both are read lazily; the
 *  export context is rebuilt per flush because it snapshots live state. */
export interface TraceSliceContext {
  options: ServiceOptions
  getCapturer: () => SessionCapturer
  getBrowser: () => WebdriverIO.Browser | undefined
  buildExportContext: (browser: WebdriverIO.Browser) => TraceExportContext
}

export class TraceSliceTracker {
  /** Index ranges into the session capturer's flat arrays, one per slice. */
  readonly ranges: SpecRange[] = []

  /** Slice keys already flushed to disk. Shared by reference with the export
   *  context so the end-of-run finalizer dedupes what was flushed eagerly. */
  readonly flushed = new Set<string>()

  #ctx: TraceSliceContext

  constructor(ctx: TraceSliceContext) {
    this.#ctx = ctx
  }

  /** Record a trace-slice boundary. `spec` slices per file; `test` per test
   *  (retries keyed per attempt by core); `session` records nothing. The
   *  previous-slice flush fires for `spec`; `test` slices eager-flush at their
   *  own test end (see flushTest) so this is only a missed-slice net. */
  recordBoundary(specFile: string | undefined, testUid?: string): void {
    if (!specFile) {
      return
    }
    const prevRange = recordSliceBoundary(
      {
        specRanges: this.ranges,
        flushedSpecs: this.flushed,
        capturer: this.#ctx.getCapturer()
      },
      this.#ctx.options.traceGranularity,
      specFile,
      testUid
    )
    const browser = this.#ctx.getBrowser()
    if (prevRange && browser) {
      // Fire-and-forget: errors are logged, never thrown, so a failed flush of
      // the previous slice can't abort the test that just started.
      void flushRangeLogged(this.#ctx.buildExportContext(browser), prevRange)
    }
  }

  /** Awaited eager flush of the just-ended test's slice (test granularity), run
   *  after the outcome is stamped so this attempt's metadata is written before a
   *  retry's beforeTest overwrites the entry; the end-of-run finalizer then
   *  dedupes it via the key set. Returns the produced artifact (for same-hook
   *  Allure attach); undefined when the test recorded no range. */
  async flushTest(testUid: string): Promise<TraceArtifact | undefined> {
    const browser = this.#ctx.getBrowser()
    if (
      this.#ctx.options.traceGranularity !== 'test' ||
      this.#ctx.options.mode !== 'trace' ||
      !browser
    ) {
      return undefined
    }
    const range = findFlushableRange(this.ranges, testUid)
    if (!range) {
      return undefined
    }
    return flushRangeLogged(this.#ctx.buildExportContext(browser), range)
  }
}
