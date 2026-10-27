import { RetryTracker } from '@wdio/devtools-core'

import { SuiteManager } from '../../src/helpers/suiteManager.js'
import { TestReporter } from '../../src/reporter.js'
import type { SessionCapturer } from '../../src/session.js'
import type { SessionLifecycleCtx } from '../../src/session-lifecycle.js'
import {
  ensureRunnerlessTracking,
  type TestManagementCtx
} from '../../src/test-management.js'

export type PlainScriptCtx = SessionLifecycleCtx & TestManagementCtx

/** A live, runnerless lifecycle bag whose suites updates go out on `capturer`. */
export function plainScriptCtx(capturer: SessionCapturer): PlainScriptCtx {
  const reporter = new TestReporter((suites) =>
    capturer.sendUpstream('suites', suites)
  )
  let finalized = false
  // Only the fields a live, runnerless onSessionEnd reads; the rest of the bag is irrelevant here.
  const ctx = {
    retryTracker: new RetryTracker(),
    testReporter: reporter,
    suiteManager: new SuiteManager(reporter),
    testManager: undefined,
    testFilePath: undefined,
    pendingTestActions: [],
    pendingScenario: null,
    sessionCapturer: capturer,
    options: { hostname: '127.0.0.1', port: 0, openUi: false },
    detectedRunner: 'node',
    isReuse: false,
    get finalized() {
      return finalized
    },
    setFinalized: (v: boolean) => {
      finalized = v
    },
    resetRetryTracker: () => {},
    actionSnapshots: [],
    snapshotCaptures: [],
    traceFlushes: [],
    specRanges: [],
    flushedSpecs: new Set<string>(),
    artifacts: [],
    filmstripFrames: []
  } as unknown as PlainScriptCtx
  ensureRunnerlessTracking(ctx, 'node')
  return ctx
}
