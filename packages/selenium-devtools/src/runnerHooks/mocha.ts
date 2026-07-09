import logger from '@wdio/logger'
import { errorMessage } from '@wdio/devtools-core'
import { findTestLineInFile } from '../helpers/utils.js'
import type { MochaTestCtx, RunnerHookCallbacks } from '../types.js'

const log = logger('@wdio/selenium-devtools:runnerHooks:mocha')

type MochaGlobals = {
  beforeEach?: (fn: (this: { currentTest?: MochaTestCtx }) => void) => void
  afterEach?: (fn: (this: { currentTest?: MochaTestCtx }) => void) => void
  before?: (fn: () => void) => void
  after?: (fn: () => void) => void
}

interface MochaCounters {
  runStartTs: number
  started: number
  passed: number
  failed: number
  pending: number
}

function registerMochaRunLifecycle(
  g: MochaGlobals,
  counters: MochaCounters,
  callbacks: RunnerHookCallbacks
): void {
  if (typeof g.before !== 'function' || typeof g.after !== 'function') {
    return
  }
  g.before(() => {
    counters.runStartTs = Date.now()
    log.info('🧪 Test run starting')
  })
  g.after(() => {
    const durationMs = Date.now() - counters.runStartTs
    const duration = (durationMs / 1000).toFixed(2)
    log.info(
      `🧪 Test run complete: ${counters.passed} passed, ${counters.failed} failed` +
        (counters.pending ? `, ${counters.pending} pending` : '') +
        ` (${duration}s, ${counters.started} total)`
    )
    callbacks.onTestRunComplete?.({
      passed: counters.passed,
      failed: counters.failed,
      pending: counters.pending,
      durationMs
    })
  })
}

function resolveCallSource(
  file: string | undefined,
  title: string,
  kind?: 'suite'
): string | undefined {
  if (!file) {
    return undefined
  }
  const line = findTestLineInFile(file, title, kind)
  return line ? `${file}:${line}` : `${file}:0`
}

function makeMochaBeforeEach(
  counters: MochaCounters,
  callbacks: RunnerHookCallbacks
): (this: { currentTest?: MochaTestCtx }) => void {
  return function (this: { currentTest?: MochaTestCtx }) {
    if (counters.runStartTs === 0) {
      counters.runStartTs = Date.now()
    }
    const test = this?.currentTest
    if (!test?.title) {
      return
    }
    log.info(`▶ Test: "${test.title}"`)
    counters.started++
    // Mocha's root suite has an empty title — skip so we don't blank the dashboard.
    const parentTitle =
      typeof test.parent?.title === 'string' && test.parent.title.length > 0
        ? test.parent.title
        : undefined
    callbacks.onTestStart(
      test.title,
      test.file,
      resolveCallSource(test.file, test.title),
      parentTitle,
      parentTitle
        ? resolveCallSource(test.file, parentTitle, 'suite')
        : undefined,
      typeof test._currentRetry === 'number' ? test._currentRetry : undefined
    )
  }
}

function resolveMochaState(
  test: MochaTestCtx | undefined
): 'passed' | 'failed' | 'pending' {
  if (test?.state === 'failed') {
    return 'failed'
  }
  if (test?.state === 'pending') {
    return 'pending'
  }
  return 'passed'
}

function makeMochaAfterEach(
  counters: MochaCounters,
  callbacks: RunnerHookCallbacks
): (this: { currentTest?: MochaTestCtx }) => void {
  return function (this: { currentTest?: MochaTestCtx }) {
    const test = this?.currentTest
    const state = resolveMochaState(test)
    const icon = state === 'passed' ? '✓' : state === 'failed' ? '✗' : '○'
    const duration =
      typeof test?.duration === 'number' ? ` (${test.duration}ms)` : ''
    log.info(`${icon} Test: "${test?.title ?? 'unknown'}"${duration}`)
    if (state === 'passed') {
      counters.passed++
    } else if (state === 'failed') {
      counters.failed++
    } else {
      counters.pending++
    }
    callbacks.onTestEnd(state)
  }
}

// Use beforeEach/afterEach — wrapping `it()` breaks `it.skip` / `it.only`.
export function tryRegisterMochaHooks(callbacks: RunnerHookCallbacks): boolean {
  // Double-cast: built-in `globalThis` lacks the mocha globals; kept local
  // (not `declare global`) so consumers don't get them as ambient types.
  const g = globalThis as unknown as MochaGlobals
  if (typeof g.beforeEach !== 'function' || typeof g.afterEach !== 'function') {
    return false
  }
  const counters: MochaCounters = {
    runStartTs: 0,
    started: 0,
    passed: 0,
    failed: 0,
    pending: 0
  }
  try {
    registerMochaRunLifecycle(g, counters, callbacks)
    g.beforeEach!(makeMochaBeforeEach(counters, callbacks))
    g.afterEach!(makeMochaAfterEach(counters, callbacks))
    log.info(
      '✓ Mocha hooks registered — startTest/endTest will fire automatically per it()'
    )
    return true
  } catch (err) {
    log.warn(`Failed to register mocha hooks: ${errorMessage(err)}`)
    return false
  }
}
