import logger from '@wdio/logger'
import { errorMessage } from '@wdio/devtools-core'
import { findTestLineInFile } from '../helpers/utils.js'
import type { RunnerHookCallbacks } from '../types.js'

const log = logger('@wdio/selenium-devtools:runnerHooks:jest')

// Jest/Vitest globals — kept as a local shape rather than a `declare global`
// so consumers of this package don't pick up `describe`/`it` as ambient
// globals when they may not actually be present.
type JestFn = (...args: unknown[]) => unknown
type JestGlobals = {
  describe?: JestFn
  test?: JestFn
  it?: JestFn
  beforeAll?: JestFn
  afterAll?: JestFn
  beforeEach?: JestFn
  afterEach?: JestFn
  expect?: { getState?: () => unknown }
}

interface JestState {
  describeStack: string[]
  testToDescribeStack: Map<string, string[]>
  testFailures: Map<string, Error>
  runStartTs: number
  testsStarted: number
  testsPassed: number
  testsFailed: number
  currentName: string
}

function copyModifiers<T extends object>(wrapped: T, orig: T): void {
  const wrappedObj = wrapped as unknown as Record<string | symbol, unknown>
  const origObj = orig as unknown as Record<string | symbol, unknown>
  for (const k of Reflect.ownKeys(origObj)) {
    try {
      wrappedObj[k] = origObj[k]
    } catch {
      /* read-only own keys */
    }
  }
}

function wrapDescribe<T extends JestFn>(
  orig: T,
  g: JestGlobals,
  state: JestState
): T {
  const wrapped = ((name: string, fn: () => void, ...rest: unknown[]) => {
    state.describeStack.push(name)
    try {
      return (orig as (...args: unknown[]) => unknown).call(
        g,
        name,
        fn,
        ...rest
      )
    } finally {
      state.describeStack.pop()
    }
  }) as unknown as T
  copyModifiers(wrapped, orig)
  return wrapped
}

function wrapTestRegistrar<T extends JestFn>(
  orig: T,
  g: JestGlobals,
  state: JestState
): T {
  const wrapped = ((name: string, fn: unknown, timeout?: number) => {
    const stackAtRegistration = [...state.describeStack]
    const jestKey = [...stackAtRegistration, name].join(' ')
    const vitestKey = [...stackAtRegistration, name].join(' > ')
    state.testToDescribeStack.set(jestKey, stackAtRegistration)
    state.testToDescribeStack.set(vitestKey, stackAtRegistration)
    const wrappedFn =
      typeof fn === 'function'
        ? wrapTestFn(fn as JestFn, name, jestKey, vitestKey, state)
        : fn
    return (orig as (...args: unknown[]) => unknown).call(
      g,
      name,
      wrappedFn,
      timeout
    )
  }) as unknown as T
  copyModifiers(wrapped, orig)
  return wrapped
}

function wrapTestFn(
  fn: JestFn,
  name: string,
  jestKey: string,
  vitestKey: string,
  state: JestState
): JestFn {
  return function (this: unknown, ...fnArgs: unknown[]) {
    // Key by inner test name — under Vitest the describe-stack capture isn't
    // reliable, so `name` is the only stable identifier shared with afterEach.
    const recordFailure = (err: Error) => {
      state.testFailures.set(name, err)
      state.testFailures.set(jestKey, err)
      state.testFailures.set(vitestKey, err)
    }
    let result: unknown
    try {
      result = fn.apply(this, fnArgs)
    } catch (err) {
      recordFailure(err as Error)
      throw err
    }
    if (result && typeof (result as Promise<unknown>).then === 'function') {
      return (result as Promise<unknown>).catch((err: unknown) => {
        recordFailure(err as Error)
        throw err
      })
    }
    return result
  }
}

function resolveTestNames(
  fullName: string,
  state: JestState
): { innerName: string; suiteName: string | undefined } {
  const stack = state.testToDescribeStack.get(fullName) ?? []
  if (stack.length > 0) {
    const jestPath = stack.join(' ')
    const vitestPath = stack.join(' > ')
    let innerName = fullName
    if (fullName.startsWith(jestPath + ' ')) {
      innerName = fullName.slice(jestPath.length + 1)
    } else if (fullName.startsWith(vitestPath + ' > ')) {
      innerName = fullName.slice(vitestPath.length + 3)
    }
    return { innerName, suiteName: stack[0] }
  }
  if (fullName.includes(' > ')) {
    const segments = fullName.split(' > ')
    return {
      innerName: segments[segments.length - 1],
      suiteName: segments[0]
    }
  }
  return { innerName: fullName, suiteName: undefined }
}

function registerJestRunLifecycle(
  g: JestGlobals,
  state: JestState,
  callbacks: RunnerHookCallbacks
): void {
  if (typeof g.beforeAll !== 'function' || typeof g.afterAll !== 'function') {
    return
  }
  g.beforeAll(() => {
    state.runStartTs = Date.now()
    log.info('🧪 Test run starting')
  })
  g.afterAll(() => {
    const durationMs = Date.now() - state.runStartTs
    const duration = (durationMs / 1000).toFixed(2)
    log.info(
      `🧪 Test run complete: ${state.testsPassed} passed, ${state.testsFailed} failed ` +
        `(${duration}s, ${state.testsStarted} total)`
    )
    callbacks.onTestRunComplete?.({
      passed: state.testsPassed,
      failed: state.testsFailed,
      pending: 0,
      durationMs
    })
  })
}

function registerJestBeforeEach(
  g: JestGlobals,
  state: JestState,
  callbacks: RunnerHookCallbacks
): void {
  g.beforeEach!(() => {
    if (state.runStartTs === 0) {
      state.runStartTs = Date.now()
    }
    const expectState = g.expect!.getState!() as {
      currentTestName?: string
      testPath?: string
    }
    const fullName = expectState?.currentTestName || ''
    const file = expectState?.testPath || undefined
    if (!fullName) {
      return
    }

    const { innerName, suiteName } = resolveTestNames(fullName, state)
    state.currentName = innerName
    const callSource = file
      ? `${file}:${findTestLineInFile(file, innerName) || 0}`
      : undefined
    const suiteCallSource =
      suiteName && file
        ? `${file}:${findTestLineInFile(file, suiteName, 'suite') || 0}`
        : undefined

    log.info(`▶ Test: "${innerName}"`)
    state.testsStarted++
    callbacks.onTestStart(
      innerName,
      file,
      callSource,
      suiteName,
      suiteCallSource
    )
  })
}

// `suppressedErrors` only catches failed expect()s; thrown errors (e.g.
// selenium TimeoutError) are tracked separately to mark those tests failed too.
function registerJestAfterEach(
  g: JestGlobals,
  state: JestState,
  callbacks: RunnerHookCallbacks
): void {
  g.afterEach!(() => {
    const expectState = g.expect!.getState!() as {
      suppressedErrors?: unknown[]
      currentTestName?: string
    }
    const fullName = expectState?.currentTestName || ''
    // Try recorded full-path keys first, then inner test name — under Vitest
    // the stack capture is empty so we keyed by inner name.
    const innerKey =
      fullName.split(' > ').pop() ?? fullName.split(' ').pop() ?? fullName
    const thrown =
      state.testFailures.get(fullName) ??
      state.testFailures.get(fullName.replace(/ > /g, ' ')) ??
      state.testFailures.get(fullName.replace(/ /g, ' > ')) ??
      state.testFailures.get(innerKey)
    const expectFailed =
      Array.isArray(expectState?.suppressedErrors) &&
      expectState.suppressedErrors.length > 0
    const failed = !!thrown || expectFailed
    if (thrown) {
      state.testFailures.delete(fullName)
      state.testFailures.delete(fullName.replace(/ > /g, ' '))
      state.testFailures.delete(fullName.replace(/ /g, ' > '))
      state.testFailures.delete(innerKey)
    }
    const finalState: 'passed' | 'failed' = failed ? 'failed' : 'passed'
    const icon = finalState === 'passed' ? '✓' : '✗'
    log.info(`${icon} Test: "${state.currentName || 'unknown'}"`)
    if (finalState === 'passed') {
      state.testsPassed++
    } else {
      state.testsFailed++
    }
    callbacks.onTestEnd(finalState)
  })
}

export function tryRegisterJestHooks(callbacks: RunnerHookCallbacks): boolean {
  // Double-cast required: built-in `globalThis` type doesn't include the
  // runner globals, and they aren't structurally compatible.
  const g = globalThis as unknown as JestGlobals
  if (
    typeof g.beforeEach !== 'function' ||
    typeof g.afterEach !== 'function' ||
    typeof g.expect?.getState !== 'function'
  ) {
    return false
  }

  const state: JestState = {
    describeStack: [],
    testToDescribeStack: new Map(),
    testFailures: new Map(),
    runStartTs: 0,
    testsStarted: 0,
    testsPassed: 0,
    testsFailed: 0,
    currentName: ''
  }

  if (typeof g.describe === 'function') {
    g.describe = wrapDescribe(g.describe, g, state)
  }
  if (typeof g.test === 'function') {
    g.test = wrapTestRegistrar(g.test, g, state)
  }
  if (typeof g.it === 'function') {
    g.it = wrapTestRegistrar(g.it, g, state)
  }

  try {
    registerJestRunLifecycle(g, state, callbacks)
    registerJestBeforeEach(g, state, callbacks)
    registerJestAfterEach(g, state, callbacks)
    log.info(
      '✓ Jest hooks registered — startTest/endTest will fire automatically per test()'
    )
    return true
  } catch (err) {
    log.warn(`Failed to register jest hooks: ${errorMessage(err)}`)
    return false
  }
}
