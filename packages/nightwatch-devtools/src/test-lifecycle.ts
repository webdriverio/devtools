/**
 * Test (Mocha/Jasmine-style) lifecycle helpers for the Nightwatch plugin.
 *
 * Extracted from the plugin class to keep `index.ts` under the file-size cap
 * and to keep the per-test orchestration distinct from the cucumber path.
 *
 * The plugin passes itself as a `TestLifecycleCtx` — a narrow interface that
 * exposes only the fields and methods these helpers need.
 */

import logger from '@wdio/logger'
import type { TestReporter } from './reporter.js'
import type { TestManager } from './helpers/testManager.js'
import type { SuiteManager } from './helpers/suiteManager.js'
import type { BrowserProxy } from './helpers/browserProxy.js'
import type {
  NightwatchBrowser,
  NightwatchCurrentTest,
  NightwatchTestCase,
  NightwatchTestResults,
  SuiteStats,
  TestStats
} from './types.js'
import { DEFAULTS, TIMING, TEST_STATE } from './constants.js'
import { resolveSpecFilePath } from './helpers/specFileResolver.js'
import { closePreviousTest } from './helpers/closePreviousTest.js'
import { extractTestMetadata, determineTestState } from './helpers/utils.js'
import { recordTestSliceBoundary, type TestSliceCtx } from './trace-slices.js'

const log = logger('@wdio/nightwatch-devtools:test-lifecycle')

export interface TestLifecycleCtx extends TestSliceCtx {
  readonly testReporter: TestReporter
  readonly testManager: TestManager
  readonly suiteManager: SuiteManager
  readonly browserProxy: BrowserProxy
  readonly srcFolders: string[]
  isScriptInjected: boolean
  getRerunLabel(): string | undefined
  incrementCount(state: TestStats['state']): void
  testIcon(state: TestStats['state']): string
  setCurrentTest(t: unknown): void
  recordAttempt(uid: string): number
}

interface SuiteMetadata {
  testFile: string
  fullPath: string | null
  suiteTitle: string
  testNames: string[]
  suiteLine: number | null
  testLines: number[]
}

export function resolveSuiteMetadata(
  ctx: TestLifecycleCtx,
  currentTest: NightwatchCurrentTest
): SuiteMetadata {
  const moduleName = currentTest.module ?? ''
  const testFile =
    moduleName.split('/').pop() || moduleName || DEFAULTS.FILE_NAME
  const fullPath = resolveSpecFilePath(
    testFile,
    moduleName,
    ctx.srcFolders,
    ctx.browserProxy.getCurrentTestFullPath() || undefined
  )
  if (!fullPath) {
    log.warn(
      `[beforeEach] Could not resolve file path for "${testFile}" — source view will be unavailable`
    )
  }
  let suiteTitle = testFile
  let testNames: string[] = []
  let suiteLine: number | null = null
  let testLines: number[] = []
  if (fullPath) {
    const parsed = extractTestMetadata(fullPath)
    if (parsed.suiteTitle) {
      suiteTitle = parsed.suiteTitle
    }
    testNames = parsed.testNames
    suiteLine = parsed.suiteLine
    testLines = parsed.testLines
  }
  const rerunLabel = ctx.getRerunLabel()
  if (rerunLabel) {
    const targetIndex = testNames.findIndex((name) => name === rerunLabel)
    if (targetIndex !== -1) {
      testNames = [testNames[targetIndex]]
      testLines = testLines[targetIndex] ? [testLines[targetIndex]] : []
    }
  }
  return { testFile, fullPath, suiteTitle, testNames, suiteLine, testLines }
}

export function pickCurrentTestName(
  currentTest: NightwatchCurrentTest,
  testNames: string[],
  processedTests: Set<string>
): string | undefined {
  const runtimeTestName =
    typeof currentTest?.name === 'string' ? currentTest.name.trim() : undefined
  const matchedRuntimeTestName = runtimeTestName
    ? testNames.find(
        (name) =>
          runtimeTestName === name || runtimeTestName.endsWith(` ${name}`)
      )
    : undefined
  return (
    matchedRuntimeTestName ||
    testNames.find((name) => !processedTests.has(name))
  )
}

export async function startNextTest(
  ctx: TestLifecycleCtx,
  currentSuite: SuiteStats,
  currentTestName: string,
  processedTests: Set<string>,
  specFile: string | null
): Promise<void> {
  if (processedTests.size === 0) {
    ctx.suiteManager.markSuiteAsRunning(currentSuite)
  }
  const test = ctx.testManager.findTestInSuite(currentSuite, currentTestName)
  if (test) {
    // Nightwatch has no per-test retry index; the tracker is the retry signal.
    test.retries = ctx.recordAttempt(test.uid)
    if (specFile) {
      recordTestSliceBoundary(ctx, specFile, test.uid)
    }
    test.state = TEST_STATE.RUNNING as TestStats['state']
    test.start = new Date()
    test.end = null
    ctx.testReporter.onTestStart(test)
    ctx.setCurrentTest(test)
    log.info(`  ▶ ${currentTestName}`)
    await new Promise((resolve) => setTimeout(resolve, TIMING.TEST_START_DELAY))
  } else {
    log.warn(
      `Test "${currentTestName}" not found in suite "${currentSuite.title}"`
    )
    ctx.setCurrentTest(null)
  }
}

export async function closePreviousRunningTest(
  ctx: TestLifecycleCtx,
  currentSuite: SuiteStats,
  testFile: string,
  currentTest: NightwatchCurrentTest
): Promise<void> {
  const runningTest = currentSuite.tests.find(
    (t): t is TestStats =>
      typeof t !== 'string' && t.state === TEST_STATE.RUNNING
  )
  if (!runningTest) {
    return
  }
  await closePreviousTest({
    runningTest,
    testFile,
    testcases: currentTest?.results?.testcases || {},
    testManager: ctx.testManager,
    incrementCount: (state) => ctx.incrementCount(state),
    testIcon: (state) => ctx.testIcon(state)
  })
}

export function wrapBrowserOnce(
  ctx: TestLifecycleCtx,
  browser: NightwatchBrowser
): void {
  if (!ctx.isScriptInjected) {
    ctx.browserProxy.wrapUrlMethod(browser)
    ctx.isScriptInjected = true
  }
  ctx.browserProxy.resetCommandTracking()
  ctx.browserProxy.wrapBrowserCommands(browser)
}

function closeUnreportedRunningTest(
  ctx: TestLifecycleCtx,
  currentSuite: SuiteStats,
  testFile: string,
  results: NightwatchTestResults,
  processedTests: Set<string>
): void {
  const runningTest = currentSuite.tests.find(
    (t): t is TestStats =>
      typeof t !== 'string' && t.state === TEST_STATE.RUNNING
  )
  if (!runningTest || processedTests.has(runningTest.title)) {
    return
  }
  const failed = (results.errors ?? 0) > 0 || (results.failed ?? 0) > 0
  const testState: TestStats['state'] = failed
    ? TEST_STATE.FAILED
    : TEST_STATE.PASSED
  const endTime = new Date()
  const duration = endTime.getTime() - (runningTest.start?.getTime() || 0)
  ctx.testManager.updateTestState(runningTest, testState, endTime, duration)
  ctx.testManager.markTestAsProcessed(testFile, runningTest.title)
  ctx.incrementCount(testState)
  const icon = ctx.testIcon(testState)
  log.info(`  ${icon} ${runningTest.title} (${(duration / 1000).toFixed(2)}s)`)
}

async function closeReportedTestcases(
  ctx: TestLifecycleCtx,
  currentSuite: SuiteStats,
  testFile: string,
  testcases: Record<string, NightwatchTestCase>,
  processedTests: Set<string>
): Promise<void> {
  const testcaseNames = Object.keys(testcases)
  const unprocessedTests = testcaseNames.filter(
    (name) => !processedTests.has(name)
  )
  for (const currentTestName of unprocessedTests) {
    const testcase = testcases[currentTestName]
    const testState = determineTestState(testcase)
    const test = ctx.testManager.findTestInSuite(currentSuite, currentTestName)
    if (test) {
      const dur = parseFloat(testcase.time || '0') * 1000
      ctx.testManager.updateTestState(test, testState, new Date(), dur)
      ctx.incrementCount(testState)
      const icon = ctx.testIcon(testState)
      log.info(`  ${icon} ${currentTestName} (${(dur / 1000).toFixed(2)}s)`)
    }
    ctx.testManager.markTestAsProcessed(testFile, currentTestName)
  }
  if (processedTests.size === testcaseNames.length) {
    ctx.suiteManager.finalizeSuite(currentSuite)
    await new Promise((resolve) =>
      setTimeout(resolve, TIMING.SUITE_COMPLETE_DELAY)
    )
  }
}

export async function closeOutTestcases(
  ctx: TestLifecycleCtx,
  browser: NightwatchBrowser
): Promise<void> {
  const currentTest = (browser.currentTest ?? {}) as NightwatchCurrentTest
  const results: NightwatchTestResults = currentTest.results ?? {}
  const moduleName = currentTest.module ?? ''
  const testFile = moduleName.split('/').pop() || DEFAULTS.FILE_NAME
  const testcases = results.testcases ?? {}
  const currentSuite = ctx.suiteManager.getSuite(testFile)
  if (!currentSuite) {
    return
  }
  const processedTests = ctx.testManager.getProcessedTests(testFile)
  if (Object.keys(testcases).length === 0) {
    closeUnreportedRunningTest(
      ctx,
      currentSuite,
      testFile,
      results,
      processedTests
    )
  } else {
    await closeReportedTestcases(
      ctx,
      currentSuite,
      testFile,
      testcases,
      processedTests
    )
  }
}
