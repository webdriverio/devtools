import { describe, it, expect, vi } from 'vitest'
import { collectSuiteTestMetadata } from '@wdio/devtools-core'

import { resetSignatureCounters } from '../src/helpers/utils.js'
import { TestManager } from '../src/helpers/testManager.js'
import { SuiteManager } from '../src/helpers/suiteManager.js'
import { TestReporter } from '../src/reporter.js'
import { SessionCapturer } from '../src/session.js'
import {
  buildTraceExportContext,
  type SessionLifecycleCtx
} from '../src/session-lifecycle.js'

function makeManager() {
  resetSignatureCounters()
  const reporter = new TestReporter(vi.fn())
  const suiteManager = new SuiteManager(reporter)
  const rootSuite = suiteManager.getOrCreateRootSuite('/spec.ts', 'Suite')
  const mgr = new TestManager(rootSuite, reporter, suiteManager)
  return { mgr, suiteManager, rootSuite }
}

describe('retry/attempt capture', () => {
  it('re-entering the start hook for the same test increments retries (heuristic)', () => {
    const { mgr } = makeManager()

    const first = mgr.startMarkedTest('flaky')
    expect(first.retries).toBe(0)

    mgr.endCurrent('failed')
    const retry = mgr.startMarkedTest('flaky')
    expect(retry.retries).toBe(1)

    mgr.endCurrent('failed')
    const retry2 = mgr.startMarkedTest('flaky')
    expect(retry2.retries).toBe(2)
  })

  it('prefers the authoritative Mocha attempt over the heuristic', () => {
    const { mgr } = makeManager()

    // First start: heuristic would be 0, authoritative says 2 → 2 wins.
    const t = mgr.startMarkedTest('login', { attempt: 2 })
    expect(t.retries).toBe(2)

    mgr.endCurrent('failed')
    // Re-entry: heuristic would be 1, authoritative says 5 → 5 wins.
    const retry = mgr.startMarkedTest('login', { attempt: 5 })
    expect(retry.retries).toBe(5)
  })

  it('flows retries into metadata attempt and the trace ctx flags attempt info', () => {
    const { mgr, suiteManager, rootSuite } = makeManager()

    mgr.startMarkedTest('flaky')
    mgr.endCurrent('failed')
    const retry = mgr.startMarkedTest('flaky')
    mgr.endCurrent('passed')
    expect(retry.retries).toBe(1)

    const metadata = collectSuiteTestMetadata([rootSuite])
    expect(metadata.get(retry.uid)?.attempt).toBe(1)

    const capturer = new SessionCapturer()
    try {
      // Minimal structural ctx: buildTraceExportContext only reads options,
      // suiteManager and the trace accumulators, so we cast a partial to the
      // full lifecycle interface rather than standing up the whole plugin.
      const ctx = {
        options: {
          mode: 'trace',
          tracePolicy: 'retain-on-failure-and-retries',
          traceGranularity: 'session',
          traceFormat: 'zip'
        },
        suiteManager,
        actionSnapshots: [],
        specRanges: [],
        flushedSpecs: new Set<string>(),
        traceFlushes: [],
        snapshotCaptures: []
      } as unknown as SessionLifecycleCtx

      const traceCtx = buildTraceExportContext(
        ctx,
        capturer,
        'sess-1',
        '/spec.ts'
      )
      expect(traceCtx.attemptInfoAvailable).toBe(true)
      expect(traceCtx.testMetadata.get(retry.uid)?.attempt).toBe(1)
    } finally {
      capturer.cleanup()
    }
  })
})
