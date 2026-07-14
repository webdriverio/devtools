import { describe, it, expect, vi } from 'vitest'
import {
  collectSuiteTestMetadata,
  shouldRetainTrace
} from '@wdio/devtools-core'

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

describe('retry outcome ledger feeds retry-aware retention', () => {
  it('groups a fail-then-pass retry under one retry-stable uid', () => {
    const { mgr } = makeManager()

    const first = mgr.startMarkedTest('flaky')
    mgr.endCurrent('failed')
    const retry = mgr.startMarkedTest('flaky')
    mgr.endCurrent('passed')

    // Selenium gives each attempt its own suite-node uid…
    expect(first.uid).not.toBe(retry.uid)

    // …but the ledger records both attempts under ONE retry-stable uid.
    const ledger = mgr.attemptOutcomes.all()
    expect(ledger).toHaveLength(2)
    expect(ledger[0]).toMatchObject({ attempt: 0, state: 'failed' })
    expect(ledger[1]).toMatchObject({ attempt: 1, state: 'passed' })
    expect(ledger[0].uid).toBe(ledger[1].uid)
  })

  it('exposes outcomes on the ctx so retain-on-failure drops a fail-then-pass but retain-on-first-failure keeps it', () => {
    const { mgr, suiteManager } = makeManager()

    mgr.startMarkedTest('flaky')
    mgr.endCurrent('failed')
    mgr.startMarkedTest('flaky')
    mgr.endCurrent('passed')

    const capturer = new SessionCapturer()
    try {
      const ctx = {
        options: {
          mode: 'trace',
          traceGranularity: 'session',
          traceFormat: 'zip'
        },
        testManager: mgr,
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
      expect(traceCtx.outcomes).toBe(mgr.attemptOutcomes)

      const outcomes = [...traceCtx.outcomes!.all()]
      const retainOnFailure = shouldRetainTrace('retain-on-failure', {
        outcomes,
        attemptInfoAvailable: true
      })
      const retainOnFirstFailure = shouldRetainTrace(
        'retain-on-first-failure',
        {
          outcomes,
          attemptInfoAvailable: true
        }
      )

      // Final attempt passed → retain-on-failure drops it (no over-retention).
      expect(retainOnFailure.retain).toBe(false)
      // Attempt 0 failed → retain-on-first-failure still keeps it.
      expect(retainOnFirstFailure.retain).toBe(true)
    } finally {
      capturer.cleanup()
    }
  })
})
