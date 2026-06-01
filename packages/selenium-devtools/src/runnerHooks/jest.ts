import logger from '@wdio/logger'
import { findTestLineInFile } from '../helpers/utils.js'
import type { RunnerHookCallbacks } from '../types.js'

const log = logger('@wdio/selenium-devtools:runnerHooks:jest')

// `suppressedErrors` only catches failed expect()s; we track thrown errors
// (e.g. selenium TimeoutError) separately to mark those tests failed too.
// Jest/Vitest globals are untyped at runtime; we type each used slot as a
// generic callable rather than `any`, so reads + assignments still compile.
type JestFn = (...args: any[]) => any
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
export function tryRegisterJestHooks(callbacks: RunnerHookCallbacks): boolean {
  const g = globalThis as unknown as JestGlobals
  if (
    typeof g.beforeEach !== 'function' ||
    typeof g.afterEach !== 'function' ||
    typeof g.expect?.getState !== 'function'
  ) {
    return false
  }
  let runStartTs = 0
  let testsStarted = 0
  let testsPassed = 0
  let testsFailed = 0
  let currentName = ''
  // `currentTestName` is the space-joined describe path + test name (ambiguous);
  // we capture the describe stack at registration to recover suite + inner name.
  const describeStack: string[] = []
  const testToDescribeStack = new Map<string, string[]>()
  const testFailures = new Map<string, Error>()
  const wrapWithDescribePush = <T extends (...args: any[]) => any>(
    orig: T
  ): T => {
    const wrapped = ((name: string, fn: () => void, ...rest: unknown[]) => {
      describeStack.push(name)
      try {
        return (orig as (...args: unknown[]) => unknown).call(
          g,
          name,
          fn,
          ...rest
        )
      } finally {
        describeStack.pop()
      }
    }) as unknown as T
    // Preserve .skip / .only / .each modifiers.
    // Preserve `.skip` / `.only` / `.each` modifiers via index access. Casts
    // are intentional — globals are untyped at this framework boundary.
    const wrappedObj = wrapped as unknown as Record<string | symbol, unknown>
    const origObj = orig as unknown as Record<string | symbol, unknown>
    for (const k of Reflect.ownKeys(origObj)) {
      try {
        wrappedObj[k] = origObj[k]
      } catch {
        /* read-only own keys */
      }
    }
    return wrapped
  }
  const wrapTestRegistrar = <T extends (...args: any[]) => any>(orig: T): T => {
    const wrapped = ((name: string, fn: unknown, timeout?: number) => {
      const stackAtRegistration = [...describeStack]
      const jestKey = [...stackAtRegistration, name].join(' ')
      const vitestKey = [...stackAtRegistration, name].join(' > ')
      testToDescribeStack.set(jestKey, stackAtRegistration)
      testToDescribeStack.set(vitestKey, stackAtRegistration)
      let wrappedFn = fn
      if (typeof fn === 'function') {
        wrappedFn = function (this: unknown, ...fnArgs: unknown[]) {
          // Key by inner test name — under Vitest the describe-stack
          // capture isn't reliable (Vitest doesn't run describe bodies
          // through our globalThis wrap), so the only stable identifier
          // we share with afterEach is `name` itself.
          const recordFailure = (err: Error) => {
            testFailures.set(name, err)
            testFailures.set(jestKey, err)
            testFailures.set(vitestKey, err)
          }
          let result: unknown
          try {
            result = fn.apply(this, fnArgs)
          } catch (err) {
            recordFailure(err as Error)
            throw err
          }
          if (
            result &&
            typeof (result as Promise<unknown>).then === 'function'
          ) {
            return (result as Promise<unknown>).catch((err: unknown) => {
              recordFailure(err as Error)
              throw err
            })
          }
          return result
        }
      }
      return (orig as (...args: unknown[]) => unknown).call(
        g,
        name,
        wrappedFn,
        timeout
      )
    }) as unknown as T
    // Preserve `.skip` / `.only` / `.each` modifiers via index access. Casts
    // are intentional — globals are untyped at this framework boundary.
    const wrappedObj = wrapped as unknown as Record<string | symbol, unknown>
    const origObj = orig as unknown as Record<string | symbol, unknown>
    for (const k of Reflect.ownKeys(origObj)) {
      try {
        wrappedObj[k] = origObj[k]
      } catch {
        /* read-only own keys */
      }
    }
    return wrapped
  }
  if (typeof g.describe === 'function') {
    g.describe = wrapWithDescribePush(g.describe)
  }
  if (typeof g.test === 'function') {
    g.test = wrapTestRegistrar(g.test)
  }
  if (typeof g.it === 'function') {
    g.it = wrapTestRegistrar(g.it)
  }
  try {
    if (typeof g.beforeAll === 'function' && typeof g.afterAll === 'function') {
      g.beforeAll(() => {
        runStartTs = Date.now()
        log.info('🧪 Test run starting')
      })
      g.afterAll(() => {
        const durationMs = Date.now() - runStartTs
        const duration = (durationMs / 1000).toFixed(2)
        log.info(
          `🧪 Test run complete: ${testsPassed} passed, ${testsFailed} failed ` +
            `(${duration}s, ${testsStarted} total)`
        )
        callbacks.onTestRunComplete?.({
          passed: testsPassed,
          failed: testsFailed,
          pending: 0,
          durationMs
        })
      })
    }
    g.beforeEach!(() => {
      if (runStartTs === 0) {
        runStartTs = Date.now()
      }
      const state = g.expect!.getState!() as {
        currentTestName?: string
        testPath?: string
      }
      const fullName = state?.currentTestName || ''
      const file = state?.testPath || undefined
      if (!fullName) {
        return
      }
      // currentTestName: Jest joins describes with ' ', Vitest with ' > '.
      const stack = testToDescribeStack.get(fullName) ?? []
      let innerName = fullName
      let suiteName: string | undefined
      if (stack.length > 0) {
        const jestPath = stack.join(' ')
        const vitestPath = stack.join(' > ')
        if (fullName.startsWith(jestPath + ' ')) {
          innerName = fullName.slice(jestPath.length + 1)
        } else if (fullName.startsWith(vitestPath + ' > ')) {
          innerName = fullName.slice(vitestPath.length + 3)
        }
        suiteName = stack[0]
      } else if (fullName.includes(' > ')) {
        const segments = fullName.split(' > ')
        innerName = segments[segments.length - 1]
        suiteName = segments[0]
      }
      currentName = innerName
      let callSource: string | undefined
      if (file) {
        const line = findTestLineInFile(file, innerName)
        callSource = line ? `${file}:${line}` : `${file}:0`
      }
      let suiteCallSource: string | undefined
      if (suiteName && file) {
        const line = findTestLineInFile(file, suiteName, 'suite')
        suiteCallSource = line ? `${file}:${line}` : `${file}:0`
      }
      log.info(`▶ Test: "${innerName}"`)
      testsStarted++
      callbacks.onTestStart(
        innerName,
        file,
        callSource,
        suiteName,
        suiteCallSource
      )
    })
    g.afterEach!(() => {
      const state = g.expect!.getState!() as {
        suppressedErrors?: unknown[]
        currentTestName?: string
      }
      const fullName = state?.currentTestName || ''
      // Try the recorded full-path keys first, then the inner test name —
      // under Vitest the stack capture is empty so we keyed by inner name.
      const innerKey =
        fullName.split(' > ').pop() ?? fullName.split(' ').pop() ?? fullName
      const thrown =
        testFailures.get(fullName) ??
        testFailures.get(fullName.replace(/ > /g, ' ')) ??
        testFailures.get(fullName.replace(/ /g, ' > ')) ??
        testFailures.get(innerKey)
      const expectFailed =
        Array.isArray(state?.suppressedErrors) &&
        state.suppressedErrors.length > 0
      const failed = !!thrown || expectFailed
      if (thrown) {
        testFailures.delete(fullName)
        testFailures.delete(fullName.replace(/ > /g, ' '))
        testFailures.delete(fullName.replace(/ /g, ' > '))
        testFailures.delete(innerKey)
      }
      const finalState: 'passed' | 'failed' = failed ? 'failed' : 'passed'
      const icon = finalState === 'passed' ? '✓' : '✗'
      log.info(`${icon} Test: "${currentName || 'unknown'}"`)
      if (finalState === 'passed') {
        testsPassed++
      } else {
        testsFailed++
      }
      callbacks.onTestEnd(finalState)
    })
    log.info(
      '✓ Jest hooks registered — startTest/endTest will fire automatically per test()'
    )
    return true
  } catch (err) {
    log.warn(`Failed to register jest hooks: ${(err as Error).message}`)
    return false
  }
}
