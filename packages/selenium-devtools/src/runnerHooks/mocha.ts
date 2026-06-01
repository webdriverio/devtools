import logger from '@wdio/logger'
import { findTestLineInFile } from '../helpers/utils.js'
import type { MochaTestCtx, RunnerHookCallbacks } from '../types.js'

const log = logger('@wdio/selenium-devtools:runnerHooks:mocha')

// Use beforeEach/afterEach — wrapping `it()` breaks `it.skip` / `it.only`.
export function tryRegisterMochaHooks(callbacks: RunnerHookCallbacks): boolean {
  const g = globalThis as unknown as {
    beforeEach?: (fn: (this: { currentTest?: MochaTestCtx }) => void) => void
    afterEach?: (fn: (this: { currentTest?: MochaTestCtx }) => void) => void
    before?: (fn: () => void) => void
    after?: (fn: () => void) => void
  }
  if (typeof g.beforeEach !== 'function' || typeof g.afterEach !== 'function') {
    return false
  }
  let runStartTs = 0
  let testsStarted = 0
  let testsPassed = 0
  let testsFailed = 0
  let testsPending = 0
  try {
    if (typeof g.before === 'function' && typeof g.after === 'function') {
      g.before(() => {
        runStartTs = Date.now()
        log.info('🧪 Test run starting')
      })
      g.after(() => {
        const durationMs = Date.now() - runStartTs
        const duration = (durationMs / 1000).toFixed(2)
        log.info(
          `🧪 Test run complete: ${testsPassed} passed, ${testsFailed} failed` +
            (testsPending ? `, ${testsPending} pending` : '') +
            ` (${duration}s, ${testsStarted} total)`
        )
        callbacks.onTestRunComplete?.({
          passed: testsPassed,
          failed: testsFailed,
          pending: testsPending,
          durationMs
        })
      })
    }
    g.beforeEach!(function (this: { currentTest?: MochaTestCtx }) {
      // Fallback when `before` registered too late to fire.
      if (runStartTs === 0) {
        runStartTs = Date.now()
      }
      const test = this?.currentTest
      if (!test?.title) {
        return
      }
      let callSource: string | undefined
      if (test.file) {
        const line = findTestLineInFile(test.file, test.title)
        callSource = line ? `${test.file}:${line}` : `${test.file}:0`
      }
      log.info(`▶ Test: "${test.title}"`)
      testsStarted++
      // Mocha's root suite has an empty title — skip so we don't blank the dashboard.
      const parentTitle =
        typeof test.parent?.title === 'string' && test.parent.title.length > 0
          ? test.parent.title
          : undefined
      let suiteCallSource: string | undefined
      if (parentTitle && test.file) {
        const line = findTestLineInFile(test.file, parentTitle, 'suite')
        suiteCallSource = line ? `${test.file}:${line}` : `${test.file}:0`
      }
      callbacks.onTestStart(
        test.title,
        test.file,
        callSource,
        parentTitle,
        suiteCallSource
      )
    })
    g.afterEach!(function (this: { currentTest?: MochaTestCtx }) {
      const test = this?.currentTest
      const state =
        test?.state === 'failed'
          ? 'failed'
          : test?.state === 'passed'
            ? 'passed'
            : test?.state === 'pending'
              ? 'pending'
              : 'passed'
      const icon = state === 'passed' ? '✓' : state === 'failed' ? '✗' : '○'
      const duration =
        typeof test?.duration === 'number' ? ` (${test.duration}ms)` : ''
      log.info(`${icon} Test: "${test?.title ?? 'unknown'}"${duration}`)
      if (state === 'passed') {
        testsPassed++
      } else if (state === 'failed') {
        testsFailed++
      } else if (state === 'pending') {
        testsPending++
      }
      callbacks.onTestEnd(state)
    })
    log.info(
      '✓ Mocha hooks registered — startTest/endTest will fire automatically per it()'
    )
    return true
  } catch (err) {
    log.warn(`Failed to register mocha hooks: ${(err as Error).message}`)
    return false
  }
}
