import { createRequire } from 'node:module'
import logger from '@wdio/logger'
import { errorMessage } from '@wdio/devtools-core'
import type { RunnerHookCallbacks } from '../types.js'

const log = logger('@wdio/selenium-devtools:runnerHooks:cucumber')

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
    log.warn(`Failed to register cucumber hooks: ${errorMessage(err)}`)
    return false
  }
}
