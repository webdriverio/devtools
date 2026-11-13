import { describe, it, expect, vi } from 'vitest'
import {
  buildArtifactsManifest,
  collectSuiteTestMetadata,
  RetryTracker,
  shouldRetainTrace
} from '@wdio/devtools-core'

import { resetSignatureCounters } from '../src/helpers/utils.js'
import {
  endScenario,
  ensureSuiteAndTestManager,
  startScenario,
  type TestManagementCtx
} from '../src/test-management.js'
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

describe('artifacts manifest gating', () => {
  function traceCtxWith(options: Record<string, unknown>) {
    const { suiteManager } = makeManager()
    const capturer = new SessionCapturer()
    try {
      const ctx = {
        options: {
          mode: 'trace',
          traceGranularity: 'session',
          traceFormat: 'zip',
          ...options
        },
        suiteManager,
        actionSnapshots: [],
        specRanges: [],
        flushedSpecs: new Set<string>(),
        traceFlushes: [],
        snapshotCaptures: []
      } as unknown as SessionLifecycleCtx
      return buildTraceExportContext(ctx, capturer, 'sess-1', '/spec.ts')
    } finally {
      capturer.cleanup()
    }
  }

  it('does not emit the manifest by default (no option, no Allure runtime)', () => {
    expect(traceCtxWith({}).emitManifest).toBe(false)
  })

  it('emits the manifest when explicitly enabled', () => {
    expect(traceCtxWith({ emitArtifactsManifest: true }).emitManifest).toBe(
      true
    )
  })

  it('auto-enables when an allure-js-commons runtime is active', () => {
    const g = globalThis as { allureTestRuntime?: unknown }
    g.allureTestRuntime = () => ({})
    try {
      expect(traceCtxWith({}).emitManifest).toBe(true)
    } finally {
      delete g.allureTestRuntime
    }
  })

  it('an explicit false wins over an active Allure runtime', () => {
    const g = globalThis as { allureTestRuntime?: unknown }
    g.allureTestRuntime = () => ({})
    try {
      expect(traceCtxWith({ emitArtifactsManifest: false }).emitManifest).toBe(
        false
      )
    } finally {
      delete g.allureTestRuntime
    }
  })
})

describe('a Cucumber scenario is the attempt-ledger unit', () => {
  it('records one attempt for the scenario, not one per step', () => {
    const testReporter = new TestReporter(vi.fn())
    const suiteManager = new SuiteManager(testReporter)
    const rootSuite = suiteManager.getOrCreateRootSuite('/work', 'Cart')
    const testManager = new TestManager(rootSuite, testReporter, suiteManager)
    const ctx: TestManagementCtx = {
      retryTracker: new RetryTracker(),
      testReporter,
      sessionCapturer: undefined,
      suiteManager,
      testManager,
      testFilePath: undefined,
      pendingTestActions: [],
      pendingScenario: null
    }

    startScenario(ctx, 'checkout', { file: '/work/cart.feature' })
    testManager.startMarkedTest('Given a cart')
    testManager.endCurrent('passed')
    testManager.startMarkedTest('When I pay')
    testManager.endCurrent('passed')
    endScenario(ctx, 'passed')

    const scenarioUid = rootSuite.suites[0]!.uid
    expect(testManager.attemptOutcomes.forTest(scenarioUid)).toMatchObject([
      { uid: scenarioUid, attempt: 0, state: 'passed' }
    ])
  })

  it('records a scenario queued before the session existed', () => {
    const testReporter = new TestReporter(vi.fn())
    const suiteManager = new SuiteManager(testReporter)
    const ctx: TestManagementCtx = {
      retryTracker: new RetryTracker(),
      testReporter,
      sessionCapturer: undefined,
      suiteManager: undefined,
      testManager: undefined,
      testFilePath: undefined,
      pendingTestActions: [],
      pendingScenario: null
    }

    startScenario(ctx, 'checkout', { file: '/work/cart.feature' })
    ctx.suiteManager = suiteManager
    ensureSuiteAndTestManager(ctx, 'Cart')
    endScenario(ctx, 'failed', 'boom')

    const scenarioUid = suiteManager.getRootSuite()!.suites[0]!.uid
    expect(ctx.testManager!.attemptOutcomes.forTest(scenarioUid)).toMatchObject(
      [{ uid: scenarioUid, attempt: 0, state: 'failed' }]
    )
  })
})

describe('retry outcome ledger feeds retry-aware retention', () => {
  it('groups a fail-then-pass retry under one retry-stable uid', () => {
    const { mgr } = makeManager()

    const first = mgr.startMarkedTest('flaky')
    mgr.endCurrent('failed')
    const retry = mgr.startMarkedTest('flaky')
    mgr.endCurrent('passed')

    // Each attempt is the same suite-node tests[] entry…
    expect(first.uid).toBe(retry.uid)

    // …and the ledger records both attempts under that one uid.
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

describe('one tests[] entry per test across retries', () => {
  it('a Mocha retry keeps one tests[] entry whose last attempt is final', () => {
    const { mgr, rootSuite } = makeManager()

    mgr.startMarkedTest('login', { attempt: 0 })
    mgr.endCurrent('failed')
    mgr.startMarkedTest('login', { attempt: 1 })
    mgr.endCurrent('passed')

    const manifest = buildArtifactsManifest({
      sessionId: 'sess-1',
      format: 'zip',
      artifacts: [],
      testMetadata: collectSuiteTestMetadata([rootSuite]),
      attemptsFor: (uid) => mgr.attemptOutcomes.attemptsFor(uid)
    })

    expect(manifest.tests).toHaveLength(1)
    expect(manifest.tests[0]).toMatchObject({ attempt: 1 })
    expect(manifest.tests[0].attempts).toHaveLength(2)
    expect(manifest.tests[0].attempts?.[0].final).toBeFalsy()
    expect(manifest.tests[0].attempts?.[1].final).toBe(true)
  })

  it('a repeated step text is not a retry', () => {
    const { mgr, suiteManager, rootSuite } = makeManager()
    suiteManager.startScenarioSuite('scenario', '/spec.feature')

    const first = mgr.startMarkedTest('I open the page')
    mgr.endCurrent('passed')
    const second = mgr.startMarkedTest('I open the page')
    mgr.endCurrent('passed')

    expect(second.uid).not.toBe(first.uid)
    expect(second.retries).toBe(0)
    expect(mgr.attemptOutcomes.forTest(second.uid)).toHaveLength(1)
    expect(rootSuite.suites).toHaveLength(1)
  })
})

describe('failure message reaches the manifest', () => {
  it('a failed test carries its error, timing and failed attempt error', () => {
    const { mgr, rootSuite } = makeManager()

    mgr.startMarkedTest('boom')
    mgr.endCurrent('failed', 'expected 1 to equal 2')

    const manifest = buildArtifactsManifest({
      sessionId: 'sess-1',
      format: 'zip',
      artifacts: [],
      testMetadata: collectSuiteTestMetadata([rootSuite]),
      attemptsFor: (uid) => mgr.attemptOutcomes.attemptsFor(uid)
    })

    expect(manifest.tests[0]).toMatchObject({
      state: 'failed',
      error: 'expected 1 to equal 2'
    })
    expect(manifest.tests[0].startTime).toEqual(expect.any(Number))
    expect(manifest.tests[0].endTime).toEqual(expect.any(Number))
    expect(manifest.tests[0].durationMs).toEqual(expect.any(Number))
    expect(manifest.tests[0].attempts?.[0]).toMatchObject({
      state: 'failed',
      error: 'expected 1 to equal 2'
    })
  })
})
