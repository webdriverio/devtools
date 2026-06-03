/**
 * Test management for the Selenium plugin — startTest/endTest,
 * startScenario/endScenario, lazy root-suite + test-manager creation, and the
 * pending-action buffer that holds calls made before the driver is built.
 *
 * Extracted from `index.ts` to keep that file under the file-size cap. The
 * plugin passes itself as a `TestManagementCtx` — a narrow interface
 * exposing only the fields and methods these helpers need.
 */

import * as path from 'node:path'
import logger from '@wdio/logger'
import { TestManager } from './helpers/testManager.js'
import { getCallSourceFromStack } from './helpers/utils.js'
import { DEFAULTS } from './constants.js'
import type { SessionCapturer } from './session.js'
import type { TestReporter } from './reporter.js'
import type { SuiteManager } from './helpers/suiteManager.js'
import type { TestStats } from './types.js'
import type { RetryTracker } from '@wdio/devtools-core'

const log = logger('@wdio/selenium-devtools:test-management')

export type PendingTestAction =
  | {
      kind: 'start'
      name: string
      meta: { file?: string; callSource?: string }
      suiteName?: string
      suiteCallSource?: string
    }
  | { kind: 'end'; state: TestStats['state'] }

export interface PendingScenario {
  name: string
  file?: string
  callSource?: string
  featureName?: string
  featureCallSource?: string
}

export interface TestManagementCtx {
  readonly retryTracker: RetryTracker
  readonly testReporter: TestReporter | undefined
  readonly sessionCapturer: SessionCapturer | undefined
  suiteManager: SuiteManager | undefined
  testManager: TestManager | undefined
  testFileDir: string | undefined
  pendingTestActions: PendingTestAction[]
  pendingScenario: PendingScenario | null
}

export interface StartTestMeta {
  file?: string
  callSource?: string
  suiteName?: string
  suiteCallSource?: string
}

export interface StartScenarioMeta {
  file?: string
  callSource?: string
  featureName?: string
  featureCallSource?: string
}

export function startTest(
  ctx: TestManagementCtx,
  name: string,
  meta: StartTestMeta = {}
): void {
  if (!ctx.testFileDir && meta.file) {
    ctx.testFileDir = path.dirname(meta.file)
  }
  const stackInfo = getCallSourceFromStack()
  const file = meta.file || stackInfo.filePath
  const callSource = meta.callSource || stackInfo.callSource
  const resolvedMeta: { file?: string; callSource?: string } = {}
  if (file) {
    resolvedMeta.file = file
  }
  if (callSource && callSource !== 'unknown:0') {
    resolvedMeta.callSource = callSource
  }
  if (!ctx.suiteManager || !ctx.testReporter) {
    ctx.pendingTestActions.push({
      kind: 'start',
      name,
      meta: resolvedMeta,
      suiteName: meta.suiteName,
      suiteCallSource: meta.suiteCallSource
    })
    return
  }

  ensureSuiteAndTestManager(
    ctx,
    meta.suiteName ?? DEFAULTS.SESSION_TITLE,
    meta.suiteCallSource
  )
  if (meta.suiteName || meta.suiteCallSource) {
    ctx.suiteManager.setRootSuiteTitle(
      meta.suiteName ?? '',
      meta.suiteCallSource
    )
  }
  ctx.testManager!.startMarkedTest(name, resolvedMeta)
  ctx.retryTracker.reset()
  if (file) {
    ctx.sessionCapturer?.captureSource(file).catch(() => {})
  }
}

export function endTest(
  ctx: TestManagementCtx,
  state: TestStats['state'] = 'passed'
): void {
  if (!ctx.testManager) {
    ctx.pendingTestActions.push({ kind: 'end', state })
    return
  }
  ctx.testManager.endCurrent(state)
}

/** Cucumber scenario boundary — opens a sub-suite under the feature root. */
export function startScenario(
  ctx: TestManagementCtx,
  name: string,
  meta: StartScenarioMeta = {}
): void {
  if (!ctx.suiteManager || !ctx.testReporter) {
    ctx.pendingScenario = { name, ...meta }
    return
  }
  ensureSuiteAndTestManager(
    ctx,
    meta.featureName ?? DEFAULTS.SESSION_TITLE,
    meta.featureCallSource
  )
  if (meta.featureName || meta.featureCallSource) {
    ctx.suiteManager.setRootSuiteTitle(
      meta.featureName ?? '',
      meta.featureCallSource
    )
  }
  // Stamp the .feature path as `featureFile` on the root and the scenario
  // sub-suite. The root suite's `file` stays at process.cwd() (changing it
  // mid-run would shift the stable UID and orphan accumulated state on the
  // dashboard). The dashboard's rerun payload forwards `featureFile` to the
  // backend, which strips `--name` and uses it as a positional arg for
  // feature-level reruns.
  const root = ctx.suiteManager.getRootSuite()
  if (root && meta.file && root.featureFile !== meta.file) {
    root.featureFile = meta.file
    ctx.testReporter.updateSuites()
  }
  const file = meta.file ?? root?.file ?? process.cwd()
  ctx.suiteManager.startScenarioSuite(name, file, meta.callSource, meta.file)
  ctx.retryTracker.reset()
  if (meta.file) {
    ctx.sessionCapturer?.captureSource(meta.file).catch(() => {})
  }
}

export function endScenario(
  ctx: TestManagementCtx,
  state: TestStats['state'] = 'passed'
): void {
  if (!ctx.suiteManager) {
    return
  }
  ctx.testManager?.endCurrent(state)
  ctx.suiteManager.endScenarioSuite(state)
  ctx.retryTracker.reset()
}

/** Lazy-create rootSuite + testManager so they take the real describe title. */
export function ensureSuiteAndTestManager(
  ctx: TestManagementCtx,
  title: string,
  callSource?: string
): void {
  if (!ctx.suiteManager || !ctx.testReporter) {
    return
  }
  let rootSuite = ctx.suiteManager.getRootSuite()
  const created = !rootSuite
  if (!rootSuite) {
    const effectiveTitle = ctx.pendingScenario?.featureName ?? title
    rootSuite = ctx.suiteManager.getOrCreateRootSuite(
      process.cwd(),
      effectiveTitle
    )
    const cs = ctx.pendingScenario?.featureCallSource ?? callSource
    if (cs) {
      rootSuite.callSource = cs
    }
  }
  if (!ctx.testManager) {
    ctx.testManager = new TestManager(
      rootSuite,
      ctx.testReporter,
      ctx.suiteManager
    )
  }
  if (created && ctx.pendingScenario) {
    const p = ctx.pendingScenario
    ctx.pendingScenario = null
    const file = p.file ?? rootSuite.file
    ctx.suiteManager.startScenarioSuite(p.name, file, p.callSource)
    if (p.file) {
      ctx.sessionCapturer?.captureSource(p.file).catch(() => {})
    }
  }
}

/** Apply any startTest/endTest calls buffered before testManager existed. */
export function flushPendingTestActions(ctx: TestManagementCtx): void {
  if (ctx.pendingTestActions.length === 0) {
    return
  }
  for (const action of ctx.pendingTestActions) {
    if (action.kind === 'start') {
      ensureSuiteAndTestManager(
        ctx,
        action.suiteName ?? DEFAULTS.SESSION_TITLE,
        action.suiteCallSource
      )
      if (!ctx.testManager) {
        continue
      }
      if (action.suiteName || action.suiteCallSource) {
        ctx.suiteManager?.setRootSuiteTitle(
          action.suiteName ?? '',
          action.suiteCallSource
        )
      }
      ctx.testManager.startMarkedTest(action.name, action.meta)
      if (action.meta.file) {
        ctx.sessionCapturer?.captureSource(action.meta.file).catch(() => {})
      }
    } else {
      ctx.testManager?.endCurrent(action.state)
    }
  }
  ctx.pendingTestActions = []
  void log
}
