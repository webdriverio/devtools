import { createRequire } from 'node:module'
import logger from '@wdio/logger'
import { findTestLineInFile } from './helpers/utils.js'
import type { MochaTestCtx, RunnerHookCallbacks } from './types.js'

const log = logger('@wdio/selenium-devtools:runnerHooks')

// Jest is identified by `expect.getState()` (Chai's `expect` lacks it).
// Mocha is identified by `it`+`describe`+`beforeEach` without that.
// Cucumber doesn't expose globals — we detect via argv + a require probe.
export function detectRunner(): 'jest' | 'mocha' | 'cucumber' | null {
  const g = globalThis as any
  if ((process.argv[1] || '').toLowerCase().includes('cucumber')) {
    return 'cucumber'
  }
  const hasBeforeEach = typeof g.beforeEach === 'function'
  if (!hasBeforeEach) {
    return null
  }
  if (typeof g.expect?.getState === 'function') {
    return 'jest'
  }
  if (typeof g.it === 'function' && typeof g.describe === 'function') {
    return 'mocha'
  }
  return null
}

export function tryRegisterRunnerHooks(
  callbacks: RunnerHookCallbacks
): 'jest' | 'mocha' | 'cucumber' | false {
  const runner = detectRunner()
  if (runner === 'jest') {
    return tryRegisterJestHooks(callbacks) ? 'jest' : false
  }
  if (runner === 'mocha') {
    return tryRegisterMochaHooks(callbacks) ? 'mocha' : false
  }
  if (runner === 'cucumber') {
    return tryRegisterCucumberHooks(callbacks) ? 'cucumber' : false
  }
  return false
}

// Use beforeEach/afterEach — wrapping `it()` breaks `it.skip` / `it.only`.
export function tryRegisterMochaHooks(callbacks: RunnerHookCallbacks): boolean {
  const g = globalThis as any
  if (typeof g.beforeEach !== 'function' || typeof g.afterEach !== 'function') {
    return false
  }
  // Counters used by the run-level before/after hooks below.
  let runStartTs = 0
  let testsStarted = 0
  let testsPassed = 0
  let testsFailed = 0
  let testsPending = 0
  try {
    if (typeof g.before === 'function' && typeof g.after === 'function') {
      g.before(function () {
        runStartTs = Date.now()
        log.info('🧪 Test run starting')
      })
      g.after(function () {
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
    g.beforeEach(function (this: any) {
      // Fallback when `before` registered too late to fire.
      if (runStartTs === 0) {
        runStartTs = Date.now()
      }
      const test: MochaTestCtx | undefined = this?.currentTest
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
    g.afterEach(function (this: any) {
      const test: MochaTestCtx | undefined = this?.currentTest
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

// `suppressedErrors` only catches failed expect()s; we track thrown errors
// (e.g. selenium TimeoutError) separately to mark those tests failed too.
export function tryRegisterJestHooks(callbacks: RunnerHookCallbacks): boolean {
  const g = globalThis as any
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
    const wrapped = ((name: string, fn: () => void, ...rest: any[]) => {
      describeStack.push(name)
      try {
        return (orig as any).call(g, name, fn, ...rest)
      } finally {
        describeStack.pop()
      }
    }) as any as T
    // Preserve .skip / .only / .each modifiers.
    for (const k of Reflect.ownKeys(orig as any)) {
      try {
        ;(wrapped as any)[k] = (orig as any)[k]
      } catch {
        /* read-only own keys */
      }
    }
    return wrapped
  }
  const wrapTestRegistrar = <T extends (...args: any[]) => any>(orig: T): T => {
    const wrapped = ((name: string, fn: any, timeout?: number) => {
      const stackAtRegistration = [...describeStack]
      const jestKey = [...stackAtRegistration, name].join(' ')
      const vitestKey = [...stackAtRegistration, name].join(' > ')
      testToDescribeStack.set(jestKey, stackAtRegistration)
      testToDescribeStack.set(vitestKey, stackAtRegistration)
      let wrappedFn = fn
      if (typeof fn === 'function') {
        wrappedFn = function (this: any, ...fnArgs: any[]) {
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
          if (result && typeof (result as any).then === 'function') {
            return (result as Promise<unknown>).catch((err: unknown) => {
              recordFailure(err as Error)
              throw err
            })
          }
          return result
        }
      }
      return (orig as any).call(g, name, wrappedFn, timeout)
    }) as any as T
    for (const k of Reflect.ownKeys(orig as any)) {
      try {
        ;(wrapped as any)[k] = (orig as any)[k]
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
    g.beforeEach(() => {
      if (runStartTs === 0) {
        runStartTs = Date.now()
      }
      const state = g.expect.getState() as {
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
    g.afterEach(() => {
      const state = g.expect.getState() as {
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

// Loads `@cucumber/cucumber` from the user's install (peer-dep style) and
// registers BeforeAll/Before/After/AfterAll. The hook receives the full
// pickle so we can surface scenario name + feature name in the dashboard.
export function tryRegisterCucumberHooks(
  callbacks: RunnerHookCallbacks
): boolean {
  const tryLoad = (): any | null => {
    try {
      return createRequire(`${process.cwd()}/`)('@cucumber/cucumber')
    } catch {
      try {
        return createRequire(import.meta.url)('@cucumber/cucumber')
      } catch {
        return null
      }
    }
  }
  const cucumber = tryLoad()
  if (!cucumber) {
    return false
  }
  const { Before, After, BeforeAll, AfterAll, BeforeStep, AfterStep } = cucumber
  if (typeof Before !== 'function' || typeof After !== 'function') {
    return false
  }

  // BeforeStep doesn't expose which step definition matched, so we wrap the
  // Given/When/Then registrars to snapshot (pattern → uri:line) at registration.
  const stepDefinitions: Array<{
    pattern: string | RegExp
    uri: string
    line: number
  }> = []

  const selfUrl = (() => {
    try {
      return import.meta.url
    } catch {
      return ''
    }
  })()
  const selfPath = selfUrl.replace(/^file:\/\//, '')
  const isSelfFrame = (line: string): boolean => {
    if (!selfPath) {
      return false
    }
    return line.includes(selfPath) || line.includes(selfUrl)
  }

  const captureCallSite = (): { uri: string; line: number } | null => {
    const stack = new Error().stack || ''
    for (const raw of stack.split('\n')) {
      const line = raw.trim()
      if (!line.startsWith('at ')) {
        continue
      }
      if (
        line.includes('@cucumber/') ||
        line.includes('node:internal') ||
        isSelfFrame(line)
      ) {
        continue
      }
      const m =
        /\(([^)]+):(\d+):\d+\)$/.exec(line) || /at\s+(.+):(\d+):\d+$/.exec(line)
      if (m) {
        let uri = m[1]
        if (uri.startsWith('file://')) {
          uri = uri.replace(/^file:\/\//, '')
        }
        return { uri, line: Number(m[2]) }
      }
    }
    return null
  }

  for (const name of ['Given', 'When', 'Then', 'defineStep'] as const) {
    if (typeof cucumber[name] !== 'function') {
      continue
    }
    const orig = cucumber[name]
    cucumber[name] = function patchedRegistrar(...args: any[]) {
      const callSite = captureCallSite()
      if (callSite && args.length > 0) {
        stepDefinitions.push({
          pattern: args[0],
          uri: callSite.uri,
          line: callSite.line
        })
      }
      return orig.apply(this, args)
    }
    Object.assign(cucumber[name], orig)
  }

  // Cucumber-expression → regex. Handles built-in placeholders only; custom
  // types fall through to wildcard. Braces MUST be in the escape set so the
  // subsequent `\{string\}`-shaped replacements can match.
  const patternToRegex = (pattern: string): RegExp => {
    const escaped = pattern.replace(/[{}.*+?^$|()[\]\\]/g, '\\$&')
    const expanded = escaped
      .replace(/\\\{string\\\}/g, '"([^"]*)"')
      .replace(/\\\{int\\\}/g, '(-?\\d+)')
      .replace(/\\\{float\\\}/g, '(-?\\d*\\.?\\d+)')
      .replace(/\\\{word\\\}/g, '([^\\s]+)')
      .replace(/\\\{[^}]*\\\}/g, '(.+?)')
    return new RegExp(`^${expanded}$`)
  }

  const findStepDefinition = (
    text: string
  ): { uri: string; line: number } | null => {
    for (const def of stepDefinitions) {
      let regex: RegExp
      try {
        regex =
          def.pattern instanceof RegExp
            ? def.pattern
            : patternToRegex(String(def.pattern))
      } catch {
        continue
      }
      if (regex.test(text)) {
        return { uri: def.uri, line: def.line }
      }
    }
    return null
  }

  let runStartTs = 0
  let testsStarted = 0
  let testsPassed = 0
  let testsFailed = 0
  let testsPending = 0

  try {
    if (typeof BeforeAll === 'function' && typeof AfterAll === 'function') {
      BeforeAll(() => {
        runStartTs = Date.now()
        log.info('🧪 Test run starting')
      })
      AfterAll(() => {
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

    // PickleStep has no `location.line`; only the gherkinDocument AST does.
    // These maps bridge astNodeId → line for the dashboard's test-lens.
    let stepKeywordById = new Map<string, string>()
    let stepLineById = new Map<string, number>()
    let scenarioLineById = new Map<string, number>()

    Before(function (testCase: any) {
      if (runStartTs === 0) {
        runStartTs = Date.now()
      }
      const pickle = testCase?.pickle
      const name: string = pickle?.name ?? 'unknown scenario'
      const file: string | undefined = pickle?.uri
      const featureName: string | undefined =
        testCase?.gherkinDocument?.feature?.name
      const featureLine = testCase?.gherkinDocument?.feature?.location?.line

      stepKeywordById = new Map<string, string>()
      stepLineById = new Map<string, number>()
      scenarioLineById = new Map<string, number>()
      const featureChildren = testCase?.gherkinDocument?.feature?.children ?? []
      for (const child of featureChildren) {
        if (child?.scenario?.id && child?.scenario?.location?.line) {
          scenarioLineById.set(child.scenario.id, child.scenario.location.line)
        }
        const steps = child?.scenario?.steps ?? child?.background?.steps ?? []
        for (const step of steps) {
          if (step?.id && typeof step?.keyword === 'string') {
            stepKeywordById.set(step.id, step.keyword)
          }
          if (step?.id && step?.location?.line) {
            stepLineById.set(step.id, step.location.line)
          }
        }
      }

      const scenarioLineFromMap =
        Array.isArray(pickle?.astNodeIds) &&
        scenarioLineById.get(pickle.astNodeIds[0])
      const scenarioLine = scenarioLineFromMap || pickle?.location?.line
      const callSource = file
        ? scenarioLine
          ? `${file}:${scenarioLine}`
          : `${file}:0`
        : undefined
      const featureCallSource = file
        ? featureLine
          ? `${file}:${featureLine}`
          : `${file}:1`
        : undefined

      log.info(`▶ Scenario: "${name}"`)
      testsStarted++
      callbacks.onScenarioStart?.(
        name,
        file,
        callSource,
        featureName,
        featureCallSource
      )
    })

    if (typeof BeforeStep === 'function') {
      BeforeStep(function (arg: any) {
        const pickleStep = arg?.pickleStep
        if (!pickleStep) {
          return
        }
        const astId =
          Array.isArray(pickleStep.astNodeIds) && pickleStep.astNodeIds[0]
        const keyword = (astId && stepKeywordById.get(astId)) || ''
        const text: string = pickleStep.text ?? ''
        const title = `${keyword}${text}`.trim()
        // Prefer the step-definition source over the .feature line — the
        // dashboard's Source panel loads `file`, not `callSource`.
        const stepDef = findStepDefinition(text)
        const featureFile: string | undefined = arg?.pickle?.uri
        const featureLineForStep =
          (astId && stepLineById.get(astId)) || pickleStep?.location?.line
        const file = stepDef ? stepDef.uri : featureFile
        const callSource = stepDef
          ? `${stepDef.uri}:${stepDef.line}`
          : featureFile
            ? featureLineForStep
              ? `${featureFile}:${featureLineForStep}`
              : `${featureFile}:0`
            : undefined
        callbacks.onTestStart(title, file, callSource)
      })
    }

    if (typeof AfterStep === 'function') {
      AfterStep(function (arg: any) {
        const status = String(arg?.result?.status ?? '').toUpperCase()
        let state: 'passed' | 'failed' | 'pending' | 'skipped' = 'passed'
        if (
          status === 'FAILED' ||
          status === 'UNDEFINED' ||
          status === 'AMBIGUOUS'
        ) {
          state = 'failed'
        } else if (status === 'PENDING') {
          state = 'pending'
        } else if (status === 'SKIPPED') {
          state = 'skipped'
        }
        callbacks.onTestEnd(state)
      })
    }

    After(function (testCase: any) {
      const status = String(testCase?.result?.status ?? '').toUpperCase()
      let state: 'passed' | 'failed' | 'pending' = 'passed'
      if (
        status === 'FAILED' ||
        status === 'UNDEFINED' ||
        status === 'AMBIGUOUS'
      ) {
        state = 'failed'
      } else if (status === 'PENDING' || status === 'SKIPPED') {
        state = 'pending'
      }
      const icon = state === 'passed' ? '✓' : state === 'failed' ? '✗' : '○'
      log.info(`${icon} Scenario: "${testCase?.pickle?.name ?? 'unknown'}"`)
      if (state === 'passed') {
        testsPassed++
      } else if (state === 'failed') {
        testsFailed++
      } else {
        testsPending++
      }
      callbacks.onScenarioEnd?.(state)
    })

    log.info(
      '✓ Cucumber hooks registered — Before/After=scenario sub-suite, BeforeStep/AfterStep=Gherkin step tests'
    )
    return true
  } catch (err) {
    log.warn(`Failed to register cucumber hooks: ${(err as Error).message}`)
    return false
  }
}
