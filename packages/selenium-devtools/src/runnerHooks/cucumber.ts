import { createRequire } from 'node:module'
import logger from '@wdio/logger'
import { errorMessage } from '@wdio/devtools-core'
import type { RunnerHookCallbacks } from '../types.js'

const log = logger('@wdio/selenium-devtools:runnerHooks:cucumber')

type CucumberModule = Record<string, unknown> & {
  Before?: (fn: (testCase: unknown) => void) => void
  After?: (fn: (testCase: unknown) => void) => void
  BeforeAll?: (fn: () => void) => void
  AfterAll?: (fn: () => void) => void
  BeforeStep?: (fn: (arg: unknown) => void) => void
  AfterStep?: (fn: (arg: unknown) => void) => void
}

interface StepDefinition {
  pattern: string | RegExp
  uri: string
  line: number
}

interface GherkinIndex {
  stepKeywordById: Map<string, string>
  stepLineById: Map<string, number>
  scenarioLineById: Map<string, number>
}

interface RunCounters {
  runStartTs: number
  started: number
  passed: number
  failed: number
  pending: number
}

function loadCucumber(): CucumberModule | null {
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

// Cucumber-expression → regex. Handles built-in placeholders only; custom
// types fall through to wildcard.
function patternToRegex(pattern: string): RegExp {
  const escaped = pattern.replace(/[{}.*+?^$|()[\]\\]/g, '\\$&')
  const expanded = escaped
    .replace(/\\\{string\\\}/g, '"([^"]*)"')
    .replace(/\\\{int\\\}/g, '(-?\\d+)')
    .replace(/\\\{float\\\}/g, '(-?\\d*\\.?\\d+)')
    .replace(/\\\{word\\\}/g, '([^\\s]+)')
    .replace(/\\\{[^}]*\\\}/g, '(.+?)')
  return new RegExp(`^${expanded}$`)
}

function makeCallSiteCapturer(): () => { uri: string; line: number } | null {
  const selfUrl = (() => {
    try {
      return import.meta.url
    } catch {
      return ''
    }
  })()
  const selfPath = selfUrl.replace(/^file:\/\//, '')
  const isSelfFrame = (line: string): boolean =>
    !!selfPath && (line.includes(selfPath) || line.includes(selfUrl))

  return () => {
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
        const uri = m[1].startsWith('file://')
          ? m[1].replace(/^file:\/\//, '')
          : m[1]
        return { uri, line: Number(m[2]) }
      }
    }
    return null
  }
}

// BeforeStep doesn't expose which step definition matched. Wraps Given/When/Then
// to snapshot (pattern → uri:line) at registration time.
function createStepDefinitionRegistry(cucumber: CucumberModule): {
  find: (text: string) => { uri: string; line: number } | null
} {
  const defs: StepDefinition[] = []
  const captureCallSite = makeCallSiteCapturer()

  for (const name of ['Given', 'When', 'Then', 'defineStep'] as const) {
    const orig = cucumber[name]
    if (typeof orig !== 'function') {
      continue
    }
    const fn = orig as (...a: unknown[]) => unknown
    const wrapped = function patchedRegistrar(
      this: unknown,
      ...args: unknown[]
    ) {
      const callSite = captureCallSite()
      if (callSite && args.length > 0) {
        defs.push({
          pattern: args[0] as string | RegExp,
          uri: callSite.uri,
          line: callSite.line
        })
      }
      return fn.apply(this, args)
    }
    Object.assign(wrapped, orig)
    cucumber[name] = wrapped
  }

  return {
    find(text) {
      for (const def of defs) {
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
  }
}

function makeGherkinIndex(): GherkinIndex {
  return {
    stepKeywordById: new Map<string, string>(),
    stepLineById: new Map<string, number>(),
    scenarioLineById: new Map<string, number>()
  }
}

function populateGherkinIndex(index: GherkinIndex, testCase: any): void {
  index.stepKeywordById.clear()
  index.stepLineById.clear()
  index.scenarioLineById.clear()
  const featureChildren = testCase?.gherkinDocument?.feature?.children ?? []
  for (const child of featureChildren) {
    if (child?.scenario?.id && child?.scenario?.location?.line) {
      index.scenarioLineById.set(
        child.scenario.id,
        child.scenario.location.line
      )
    }
    const steps = child?.scenario?.steps ?? child?.background?.steps ?? []
    for (const step of steps) {
      if (step?.id && typeof step?.keyword === 'string') {
        index.stepKeywordById.set(step.id, step.keyword)
      }
      if (step?.id && step?.location?.line) {
        index.stepLineById.set(step.id, step.location.line)
      }
    }
  }
}

type ScenarioState = 'passed' | 'failed' | 'pending'

function mapCucumberStatus(status: string): ScenarioState | 'skipped' {
  const s = status.toUpperCase()
  if (s === 'FAILED' || s === 'UNDEFINED' || s === 'AMBIGUOUS') {
    return 'failed'
  }
  if (s === 'PENDING') {
    return 'pending'
  }
  if (s === 'SKIPPED') {
    return 'skipped'
  }
  return 'passed'
}

function registerRunLifecycleHooks(
  cucumber: CucumberModule,
  counters: RunCounters,
  callbacks: RunnerHookCallbacks
): void {
  const { BeforeAll, AfterAll } = cucumber
  if (typeof BeforeAll !== 'function' || typeof AfterAll !== 'function') {
    return
  }
  BeforeAll(() => {
    counters.runStartTs = Date.now()
    log.info('🧪 Test run starting')
  })
  AfterAll(() => {
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

function registerScenarioHooks(
  cucumber: CucumberModule,
  index: GherkinIndex,
  counters: RunCounters,
  callbacks: RunnerHookCallbacks
): void {
  const { Before, After } = cucumber
  if (typeof Before !== 'function' || typeof After !== 'function') {
    return
  }

  Before(function (testCase: any) {
    if (counters.runStartTs === 0) {
      counters.runStartTs = Date.now()
    }
    populateGherkinIndex(index, testCase)
    const pickle = testCase?.pickle
    const name: string = pickle?.name ?? 'unknown scenario'
    const file: string | undefined = pickle?.uri
    const featureName: string | undefined =
      testCase?.gherkinDocument?.feature?.name
    const featureLine = testCase?.gherkinDocument?.feature?.location?.line

    const scenarioLineFromMap =
      Array.isArray(pickle?.astNodeIds) &&
      index.scenarioLineById.get(pickle.astNodeIds[0])
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
    counters.started++
    callbacks.onScenarioStart?.(
      name,
      file,
      callSource,
      featureName,
      featureCallSource
    )
  })

  After(function (testCase: any) {
    const state = mapCucumberStatus(String(testCase?.result?.status ?? ''))
    const scenarioState: ScenarioState = state === 'skipped' ? 'pending' : state
    const icon =
      scenarioState === 'passed' ? '✓' : scenarioState === 'failed' ? '✗' : '○'
    log.info(`${icon} Scenario: "${testCase?.pickle?.name ?? 'unknown'}"`)
    if (scenarioState === 'passed') {
      counters.passed++
    } else if (scenarioState === 'failed') {
      counters.failed++
    } else {
      counters.pending++
    }
    callbacks.onScenarioEnd?.(scenarioState)
  })
}

function registerStepHooks(
  cucumber: CucumberModule,
  index: GherkinIndex,
  stepDefs: { find: (text: string) => { uri: string; line: number } | null },
  callbacks: RunnerHookCallbacks
): void {
  const { BeforeStep, AfterStep } = cucumber
  if (typeof BeforeStep === 'function') {
    BeforeStep(function (arg: any) {
      const pickleStep = arg?.pickleStep
      if (!pickleStep) {
        return
      }
      const astId =
        Array.isArray(pickleStep.astNodeIds) && pickleStep.astNodeIds[0]
      const keyword = (astId && index.stepKeywordById.get(astId)) || ''
      const text: string = pickleStep.text ?? ''
      const title = `${keyword}${text}`.trim()
      const stepDef = stepDefs.find(text)
      const featureFile: string | undefined = arg?.pickle?.uri
      const featureLineForStep =
        (astId && index.stepLineById.get(astId)) || pickleStep?.location?.line
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
      const state = mapCucumberStatus(String(arg?.result?.status ?? ''))
      callbacks.onTestEnd(state)
    })
  }
}

// Loads `@cucumber/cucumber` from the user's install (peer-dep style) and
// registers BeforeAll/Before/After/AfterAll. The hook receives the full
// pickle so we can surface scenario name + feature name in the dashboard.
export function tryRegisterCucumberHooks(
  callbacks: RunnerHookCallbacks
): boolean {
  const cucumber = loadCucumber()
  if (!cucumber) {
    return false
  }
  if (
    typeof cucumber.Before !== 'function' ||
    typeof cucumber.After !== 'function'
  ) {
    return false
  }

  const stepDefs = createStepDefinitionRegistry(cucumber)
  const counters: RunCounters = {
    runStartTs: 0,
    started: 0,
    passed: 0,
    failed: 0,
    pending: 0
  }

  try {
    registerRunLifecycleHooks(cucumber, counters, callbacks)
    const index = makeGherkinIndex()
    registerScenarioHooks(cucumber, index, counters, callbacks)
    registerStepHooks(cucumber, index, stepDefs, callbacks)
    log.info(
      '✓ Cucumber hooks registered — Before/After=scenario sub-suite, BeforeStep/AfterStep=Gherkin step tests'
    )
    return true
  } catch (err) {
    log.warn(`Failed to register cucumber hooks: ${errorMessage(err)}`)
    return false
  }
}
