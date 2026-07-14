import { describe, it, expect, vi } from 'vitest'
import {
  TestAttemptTracker,
  collectSuiteTestMetadata
} from '@wdio/devtools-core'
import { buildCucumberScenarioSuite } from '../src/helpers/cucumberScenarioBuilder.js'
import { buildTraceContext } from '../src/trace-context.js'
import { startNextTest, type TestLifecycleCtx } from '../src/test-lifecycle.js'
import { TEST_STATE } from '../src/constants.js'
import type { SessionCapturer } from '../src/session.js'
import type { SuiteStats, TestStats } from '../src/types.js'

function scenarioInput(
  recordAttempt: (uid: string, specFile?: string) => number
) {
  return {
    featureUri: 'login.feature',
    scenarioName: 'Valid login',
    featureName: 'Login',
    stepDefFiles: [],
    steps: [{ text: 'I open the page' }, { text: 'I log in' }],
    stepLines: [0, 0],
    stepKeywords: ['Given', 'When'],
    scenarioLine: 3,
    parentFeatureSuiteUid: 'feature-uid',
    recordAttempt
  }
}

function makeTest(uid: string, title: string): TestStats {
  return {
    uid,
    cid: '0-0',
    title,
    fullTitle: title,
    parent: 'suite-uid',
    state: TEST_STATE.PENDING,
    start: new Date(),
    end: null,
    type: 'test',
    file: '/spec.ts',
    retries: 0,
    _duration: 0,
    hooks: []
  }
}

describe('cucumber scenario retry attempt', () => {
  it('stamps the tracker attempt on every step and flows it to metadata.attempt', () => {
    const tracker = new TestAttemptTracker()
    const record = (uid: string) => tracker.recordStart(uid)

    const first = buildCucumberScenarioSuite(scenarioInput(record))
    expect((first.tests as TestStats[]).map((t) => t.retries)).toEqual([0, 0])

    // Same scenario name + line → same (retry-stable) uid → attempt increments.
    const retried = buildCucumberScenarioSuite(scenarioInput(record))
    expect((retried.tests as TestStats[]).map((t) => t.retries)).toEqual([1, 1])
    expect(tracker.sawRetry).toBe(true)

    const metadata = collectSuiteTestMetadata([retried])
    for (const step of retried.tests as TestStats[]) {
      expect(metadata.get(step.uid)?.attempt).toBe(1)
    }
  })

  it('defaults step attempt to 0 when no tracker is wired', () => {
    const suite = buildCucumberScenarioSuite({
      ...scenarioInput(() => 0),
      recordAttempt: undefined
    })
    expect((suite.tests as TestStats[]).every((t) => t.retries === 0)).toBe(
      true
    )
  })

  it('feeds the ledger per attempt with specFile so forSpec sees real outcomes', () => {
    const tracker = new TestAttemptTracker()
    const record = (uid: string, specFile?: string) =>
      tracker.recordStart(uid, specFile)

    // Attempt 0 fails, then the retry (same uid) passes — each attempt's real
    // outcome must survive, not collapse to the retry-stable suite's last state.
    const first = buildCucumberScenarioSuite(scenarioInput(record))
    tracker.recordOutcome(first.uid, TEST_STATE.FAILED as TestStats['state'])
    const retried = buildCucumberScenarioSuite(scenarioInput(record))
    tracker.recordOutcome(retried.uid, TEST_STATE.PASSED as TestStats['state'])

    expect(first.uid).toBe(retried.uid)
    expect(tracker.forSpec('login.feature')).toEqual([
      { uid: first.uid, attempt: 0, state: 'failed' },
      { uid: first.uid, attempt: 1, state: 'passed' }
    ])
  })
})

describe('regular test retry attempt via startNextTest', () => {
  it('records the attempt under the test uid and increments on rerun', async () => {
    const tracker = new TestAttemptTracker()
    const test = makeTest('test-uid', 'my test')
    const suite = {
      uid: 'suite-uid',
      tests: [test]
    } as unknown as SuiteStats
    const ctx = {
      suiteManager: { markSuiteAsRunning: vi.fn() },
      testManager: { findTestInSuite: () => test },
      testReporter: { onTestStart: vi.fn() },
      setCurrentTest: vi.fn(),
      recordAttempt: (uid: string) => tracker.recordStart(uid)
    } as unknown as TestLifecycleCtx

    await startNextTest(ctx, suite, 'my test', new Set(), null)
    expect(test.retries).toBe(0)

    await startNextTest(ctx, suite, 'my test', new Set(['my test']), null)
    expect(test.retries).toBe(1)
  })
})

describe('buildTraceContext', () => {
  it('sets attemptInfoAvailable and carries retries through to attempt', () => {
    const capturer = {
      actionSnapshots: [],
      snapshotCaptures: []
    } as unknown as SessionCapturer
    const test = makeTest('t1', 'retried test')
    test.retries = 2
    const suite = {
      uid: 'suite-uid',
      tests: [test],
      suites: []
    } as unknown as SuiteStats

    const ctx = buildTraceContext(
      {
        mode: 'trace',
        policy: 'on',
        granularity: 'session',
        format: 'zip',
        capturer,
        suites: [suite],
        ranges: [],
        flushed: new Set(),
        artifacts: [],
        traceFlushes: [],
        configPath: undefined,
        log: () => {}
      },
      'session-1'
    )

    expect(ctx.attemptInfoAvailable).toBe(true)
    expect(ctx.sessionId).toBe('session-1')
    expect(ctx.testMetadata.get('t1')?.attempt).toBe(2)
  })

  it('exposes the attempt-outcome ledger on the trace context', () => {
    const capturer = {
      actionSnapshots: [],
      snapshotCaptures: []
    } as unknown as SessionCapturer
    const tracker = new TestAttemptTracker()
    tracker.recordStart('t1', '/spec.ts')
    tracker.recordOutcome('t1', TEST_STATE.FAILED as TestStats['state'])

    const ctx = buildTraceContext(
      {
        mode: 'trace',
        policy: 'retain-on-failure',
        granularity: 'spec',
        format: 'zip',
        capturer,
        suites: [],
        outcomes: tracker,
        ranges: [],
        flushed: new Set(),
        artifacts: [],
        traceFlushes: [],
        configPath: undefined,
        log: () => {}
      },
      'session-1'
    )

    expect(ctx.outcomes).toBe(tracker)
    expect(ctx.outcomes?.forSpec('/spec.ts')).toEqual([
      { uid: 't1', attempt: 0, state: 'failed' }
    ])
  })
})
