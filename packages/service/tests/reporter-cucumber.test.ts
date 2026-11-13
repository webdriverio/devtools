import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { SuiteStats, TestStats } from '@wdio/reporter'
import { TestReporter } from '../src/reporter.js'

// Payloads follow CucumberFormatter, 9.33.1 and 10.2.0 differing only in the feature id (webdriverio/webdriverio#16073).

type WdioVersion = '9' | '10.2'
type Payload = Record<string, unknown>

interface StepSpec {
  id: string
  title: string
  state?: 'pass' | 'fail' | 'retry' | 'skip'
}

interface ScenarioSpec {
  title: string
  steps: StepSpec[]
}

interface FeatureSpec {
  uri: string
  title: string
  scenarios: ScenarioSpec[]
}

interface Harness {
  reporter: TestReporter
  report: ReturnType<typeof vi.fn>
  onRetry: ReturnType<typeof vi.fn>
  emit: (event: string, payload: Payload) => void
}

const CID = '0-0'

function featureId(version: WdioVersion, uri: string, rootDir: string) {
  const id =
    version === '9'
      ? path.basename(uri)
      : path.relative(rootDir, uri).split(path.sep).join('/')
  return `${id}:1:1`
}

function harness(specs: string[]): Harness {
  const report = vi.fn()
  const onRetry = vi.fn()
  const reporter = new TestReporter(
    { logFile: path.join(os.tmpdir(), 'reporter-cucumber.log') },
    report,
    () => {},
    onRetry
  )
  // CucumberFormatter.emit: formatMessage, then cid, specs and uid.
  const emit = (event: string, payload: Payload) => {
    const message: Payload = { ...payload }
    if (payload.title && payload.parent) {
      message.fullTitle = `${payload.parent}: ${payload.title}`
    }
    reporter.emit(event, { ...message, cid: CID, specs, uid: payload.uid })
  }
  reporter.emit('runner:start', {
    cid: CID,
    specs,
    capabilities: { browserName: 'chrome' },
    config: {}
  })
  return { reporter, report, onRetry, emit }
}

function featurePayload(fid: string, feature: FeatureSpec): Payload {
  return { uid: fid, title: feature.title, type: 'feature', file: feature.uri }
}

function scenarioPayload(
  pickleIndex: number,
  fid: string,
  feature: FeatureSpec,
  scenario: ScenarioSpec
): Payload {
  return {
    uid: String(pickleIndex),
    title: scenario.title,
    parent: fid,
    type: 'scenario',
    description: '',
    file: feature.uri,
    tags: []
  }
}

function stepPayload(
  pickleIndex: number,
  feature: FeatureSpec,
  scenario: ScenarioSpec,
  step: StepSpec
): Payload {
  return {
    type: 'test',
    uid: step.id,
    title: step.title,
    parent: String(pickleIndex),
    file: feature.uri,
    tags: [],
    featureName: feature.title,
    scenarioName: scenario.title
  }
}

function runSteps(
  h: Harness,
  pickleIndex: number,
  feature: FeatureSpec,
  scenario: ScenarioSpec,
  steps: StepSpec[]
) {
  for (const step of steps) {
    const payload = stepPayload(pickleIndex, feature, scenario, step)
    h.emit('test:start', payload)
    const state = step.state ?? 'pass'
    const failed = state === 'fail' || state === 'retry'
    const end = {
      ...payload,
      state: failed ? 'fail' : state,
      passed: !failed,
      ...(failed && { error: new Error(`${step.title} failed`) })
    }
    h.emit(`test:${state}`, end)
    h.emit('test:end', end)
  }
}

/** One worker's events for `features`, in the order CucumberFormatter sends them. */
function runFeatures(
  version: WdioVersion,
  rootDir: string,
  features: FeatureSpec[]
): Harness {
  const h = harness(features.map((f) => f.uri))
  let pickleIndex = 0
  for (const feature of features) {
    const fid = featureId(version, feature.uri, rootDir)
    h.emit('suite:start', featurePayload(fid, feature))
    for (const scenario of feature.scenarios) {
      const payload = scenarioPayload(pickleIndex, fid, feature, scenario)
      h.emit('suite:start', payload)
      runSteps(h, pickleIndex, feature, scenario, scenario.steps)
      h.emit('suite:end', payload)
      pickleIndex++
    }
    h.emit('suite:end', featurePayload(fid, feature))
  }
  return h
}

interface TreeNode {
  uid: string
  title: string
  type: string
  file?: string
  featureFile?: string
  featureLine?: number
  callSource?: string
  tests: { uid: string; title: string; state: string; retries?: number }[]
  suites: TreeNode[]
}

function toTree(suite: SuiteStats): TreeNode {
  return {
    uid: suite.uid,
    title: suite.title,
    type: suite.type,
    file: suite.file,
    featureFile: suite.featureFile,
    featureLine: suite.featureLine,
    callSource: suite.callSource,
    tests: suite.tests.map((t) => ({
      uid: t.uid,
      title: t.title,
      state: t.state,
      retries: t.retries
    })),
    suites: suite.suites.map(toTree)
  }
}

/** The features of the last payload the dashboard received, as it would render them. */
function sentFeatures(report: ReturnType<typeof vi.fn>): TreeNode[] {
  const payload = report.mock.calls.at(-1)?.[0] as Record<string, SuiteStats>[]
  return payload
    .map((entry) => Object.values(entry)[0])
    .filter((suite) => suite.type === 'feature')
    .map(toTree)
}

let rootDir: string
let loginA: string
let loginB: string
let loginFail: string

const LOGIN_STEPS = (prefix: string): StepSpec[] => [
  { id: `${prefix}-1`, title: 'Given I am on the login page' },
  { id: `${prefix}-2`, title: 'When I login with tomsmith and secret' },
  { id: `${prefix}-3`, title: 'Then I should see a flash message saying ok' }
]

function outlineFeature(uri: string): FeatureSpec {
  return {
    uri,
    title: 'The Internet Guinea Pig Website',
    scenarios: [
      {
        title: 'As a user, I can log into the secure area',
        steps: LOGIN_STEPS(`${uri}-row1`)
      },
      {
        title: 'As a user, I can log into the secure area',
        steps: LOGIN_STEPS(`${uri}-row2`)
      }
    ]
  }
}

function plainFeature(state: StepSpec['state'] = 'fail'): FeatureSpec {
  const steps = LOGIN_STEPS('fail')
  steps[2] = { ...steps[2], state }
  return {
    uri: loginFail,
    title: 'Deliberately failing login',
    scenarios: [{ title: 'Failing assertion', steps }]
  }
}

const OUTLINE = `Feature: The Internet Guinea Pig Website

  Scenario Outline: As a user, I can log into the secure area
    Given I am on the login page
    When I login with <username> and <password>
    Then I should see a flash message saying <message>

    Examples:
      | username | password | message |
      | tomsmith | secret   | ok      |
      | foobar   | barfoo   | ok      |
`

const PLAIN = `Feature: Deliberately failing login

  Scenario: Failing assertion
    Given I am on the login page
    When I login with tomsmith and secret
    Then I should see a flash message saying ok
`

beforeAll(() => {
  rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wdio-cucumber-uid-'))
  loginA = path.join(rootDir, 'features', 'a', 'login.feature')
  loginB = path.join(rootDir, 'features', 'b', 'login.feature')
  loginFail = path.join(rootDir, 'features', 'login-fail.feature')
  for (const file of [loginA, loginB]) {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, OUTLINE)
  }
  fs.writeFileSync(loginFail, PLAIN)
})

afterAll(() => {
  fs.rmSync(rootDir, { recursive: true, force: true })
})

describe('Cucumber suite tree on WebdriverIO 9.x and 10.2', () => {
  it('feeds the two versions different feature ids', () => {
    expect(featureId('9', loginA, rootDir)).toBe('login.feature:1:1')
    expect(featureId('10.2', loginA, rootDir)).toBe(
      'features/a/login.feature:1:1'
    )
  })

  it('builds the same tree for a scenario outline (feature-file line path)', () => {
    const v9 = sentFeatures(
      runFeatures('9', rootDir, [outlineFeature(loginA)]).report
    )
    const v10 = sentFeatures(
      runFeatures('10.2', rootDir, [outlineFeature(loginA)]).report
    )
    expect(v10).toEqual(v9)
    expect(v10[0].suites.map((s) => s.featureLine)).toEqual([10, 11])
  })

  it('builds the same tree for a plain scenario (fallback path, no line)', () => {
    const v9 = sentFeatures(runFeatures('9', rootDir, [plainFeature()]).report)
    const v10 = sentFeatures(
      runFeatures('10.2', rootDir, [plainFeature()]).report
    )
    expect(v10[0].suites[0].featureLine).toBeUndefined()
    expect(v10).toEqual(v9)
    expect(v10[0].suites[0].tests.map((t) => t.state)).toEqual([
      'passed',
      'passed',
      'failed'
    ])
  })

  it('gives the same tree on every run (stable uids)', () => {
    const first = sentFeatures(
      runFeatures('10.2', rootDir, [outlineFeature(loginA), plainFeature()])
        .report
    )
    const second = sentFeatures(
      runFeatures('10.2', rootDir, [outlineFeature(loginA), plainFeature()])
        .report
    )
    expect(second).toEqual(first)
  })

  it('keeps two same-named feature files apart, one worker each', () => {
    for (const version of ['9', '10.2'] as const) {
      const [a] = sentFeatures(
        runFeatures(version, rootDir, [outlineFeature(loginA)]).report
      )
      const [b] = sentFeatures(
        runFeatures(version, rootDir, [outlineFeature(loginB)]).report
      )
      expect(a.uid).not.toBe(b.uid)
      expect(a.suites.map((s) => s.uid)).not.toEqual(b.suites.map((s) => s.uid))
    }
  })

  it('sends both same-named features of one worker on 9.x, whose feature ids collide', () => {
    const features = [outlineFeature(loginA), outlineFeature(loginB)]
    // 9.x sends the replaced first feature after the second; the dashboard keeps the order it first saw.
    const byFile = (a: TreeNode, b: TreeNode) =>
      String(a.file).localeCompare(String(b.file))
    const v9 = sentFeatures(runFeatures('9', rootDir, features).report)
    const v10 = sentFeatures(runFeatures('10.2', rootDir, features).report)
    expect(v9.map((f) => f.file).sort()).toEqual([loginA, loginB])
    expect([...v10].sort(byFile)).toEqual([...v9].sort(byFile))
  })

  it('builds the same tree with scenarioLevelReporter, where a scenario is a test', () => {
    const trees = (['9', '10.2'] as const).map((version) => {
      const feature = plainFeature()
      const h = harness([feature.uri])
      const fid = featureId(version, feature.uri, rootDir)
      h.emit('suite:start', featurePayload(fid, feature))
      const scenario = {
        ...scenarioPayload(0, fid, feature, feature.scenarios[0])
      }
      h.emit('test:start', scenario)
      h.emit('test:pass', { ...scenario, state: 'pass', passed: true })
      h.emit('test:end', { ...scenario, state: 'pass', passed: true })
      h.emit('suite:end', featurePayload(fid, feature))
      return sentFeatures(h.report)
    })
    expect(trees[1]).toEqual(trees[0])
    expect(trees[1][0].tests).toHaveLength(1)
  })
})

describe('failed Cucumber hooks (10.2 hook:* events)', () => {
  // CucumberFormatter's testRunHookStart / testRunHookEnd.
  function runHook(
    h: Harness,
    fid: string,
    kind: 'BeforeAll' | 'AfterAll',
    error?: Error,
    uid = `run-hook-${kind}`
  ) {
    const start = {
      type: 'hook',
      uid,
      title: `${kind} (features/step-definitions/steps.ts:3)`,
      parent: fid,
      parentUid: fid,
      hookKind: kind === 'AfterAll' ? 'afterAll' : 'beforeAll',
      hookSuiteUid: fid,
      file: loginFail
    }
    h.emit('hook:start', start)
    h.emit('hook:end', {
      ...start,
      duration: 3,
      ...(error ? { state: 'failed', error } : {})
    })
  }

  it('shows a failed BeforeAll as a failed row of its feature', () => {
    const feature = plainFeature('pass')
    const h = harness([feature.uri])
    const fid = featureId('10.2', feature.uri, rootDir)
    h.emit('suite:start', featurePayload(fid, feature))
    runHook(h, fid, 'BeforeAll', new Error('database down'))
    h.emit('suite:end', featurePayload(fid, feature))

    const [tree] = sentFeatures(h.report)
    expect(tree.tests).toEqual([
      expect.objectContaining({
        title: 'BeforeAll (features/step-definitions/steps.ts:3)',
        state: 'failed'
      })
    ])
    const row = (h.reporter.suites[fid] as SuiteStats).tests[0]
    expect(row.error?.message).toBe('database down')
    expect(row.uid).toMatch(/^stable-/)
  })

  it('places a failed AfterAll after the scenarios it ran after', () => {
    const feature = plainFeature('pass')
    const h = harness([feature.uri])
    const fid = featureId('10.2', feature.uri, rootDir)
    h.emit('suite:start', featurePayload(fid, feature))
    const scenario = scenarioPayload(0, fid, feature, feature.scenarios[0])
    h.emit('suite:start', scenario)
    runSteps(h, 0, feature, feature.scenarios[0], feature.scenarios[0].steps)
    h.emit('suite:end', scenario)
    runHook(h, fid, 'AfterAll', new Error('cleanup failed'))
    h.emit('suite:end', featurePayload(fid, feature))

    const suite = h.reporter.suites[fid] as SuiteStats
    const row = suite.tests[0]
    expect(row.state).toBe('failed')
    expect(row.title).toBe('AfterAll (features/step-definitions/steps.ts:3)')
    expect(suite.suites[0].order).toBe(0)
    expect(row.order).toBe(1)
  })

  it('adds no row for a hook that passed', () => {
    const feature = plainFeature('pass')
    const h = harness([feature.uri])
    const fid = featureId('10.2', feature.uri, rootDir)
    h.emit('suite:start', featurePayload(fid, feature))
    runHook(h, fid, 'BeforeAll')
    h.emit('suite:end', featurePayload(fid, feature))
    expect((h.reporter.suites[fid] as SuiteStats).tests).toEqual([])
  })

  it('shows a failed scenario Before hook above the steps it skipped', () => {
    const feature = plainFeature('pass')
    const h = harness([feature.uri])
    const fid = featureId('10.2', feature.uri, rootDir)
    h.emit('suite:start', featurePayload(fid, feature))
    const scenarioSpec = feature.scenarios[0]
    const scenario = scenarioPayload(0, fid, feature, scenarioSpec)
    h.emit('suite:start', scenario)
    // CucumberFormatter.afterHook: buildStepPayload with the Cucumber status.
    const hook = {
      type: 'hook',
      uid: 'hook-step-1',
      title: '',
      parent: '0',
      file: feature.uri,
      tags: [],
      featureName: feature.title,
      scenarioName: scenarioSpec.title,
      hookKind: 'beforeEach'
    }
    h.emit('hook:start', hook)
    h.emit('hook:end', {
      ...hook,
      state: 'FAILED',
      error: new Error('Before failed'),
      duration: 1
    })
    runSteps(
      h,
      0,
      feature,
      scenarioSpec,
      scenarioSpec.steps.map((s) => ({ ...s, state: 'skip' as const }))
    )
    h.emit('suite:end', scenario)

    const [tree] = sentFeatures(h.report)
    expect(tree.suites[0].tests.map((t) => [t.title, t.state])).toEqual([
      ['Before', 'failed'],
      ['Given I am on the login page', 'skipped'],
      ['When I login with tomsmith and secret', 'skipped'],
      ['Then I should see a flash message saying ok', 'skipped']
    ])
  })

  it('keeps two failed After hooks of one scenario apart, on uids that survive new step ids', () => {
    const run = (hookIds: [string, string]) => {
      const feature = plainFeature('pass')
      const scenarioSpec = feature.scenarios[0]
      const h = harness([feature.uri])
      const fid = featureId('10.2', feature.uri, rootDir)
      h.emit('suite:start', featurePayload(fid, feature))
      const scenario = scenarioPayload(0, fid, feature, scenarioSpec)
      h.emit('suite:start', scenario)
      runSteps(h, 0, feature, scenarioSpec, scenarioSpec.steps)
      // Cucumber runs every After hook even after one fails.
      for (const [index, uid] of hookIds.entries()) {
        const hook = {
          type: 'hook',
          uid,
          title: '',
          parent: '0',
          file: feature.uri,
          hookKind: 'afterEach'
        }
        h.emit('hook:start', hook)
        h.emit('hook:end', {
          ...hook,
          state: 'FAILED',
          error: new Error(`After ${index + 1} failed`)
        })
      }
      h.emit('suite:end', scenario)
      return (h.reporter.suites['0'] as SuiteStats).tests.slice(3)
    }
    const rows = run(['step-id-a', 'step-id-b'])
    expect(rows.map((r) => [r.title, r.state, r.error?.message])).toEqual([
      ['After', 'failed', 'After 1 failed'],
      ['After #2', 'failed', 'After 2 failed']
    ])
    expect(rows[0].uid).not.toBe(rows[1].uid)
    expect(rows.map((r) => r.parent)).toEqual(['0', '0'])
    // Cucumber's step ids are new in every process; a rerun must land on the same rows.
    expect(run(['step-id-c', 'step-id-d']).map((r) => r.uid)).toEqual(
      rows.map((r) => r.uid)
    )
  })

  it('keeps the first failed AfterAll in place when a second one fails', () => {
    const feature = plainFeature('pass')
    const h = harness([feature.uri])
    const fid = featureId('10.2', feature.uri, rootDir)
    h.emit('suite:start', featurePayload(fid, feature))
    const scenario = scenarioPayload(0, fid, feature, feature.scenarios[0])
    h.emit('suite:start', scenario)
    runSteps(h, 0, feature, feature.scenarios[0], feature.scenarios[0].steps)
    h.emit('suite:end', scenario)
    runHook(h, fid, 'AfterAll', new Error('first'), 'after-all-1')
    runHook(h, fid, 'AfterAll', new Error('second'), 'after-all-2')
    h.emit('suite:end', featurePayload(fid, feature))

    const suite = h.reporter.suites[fid] as SuiteStats
    expect(suite.suites[0].order).toBe(0)
    expect(suite.tests.map((t) => [t.error?.message, t.order])).toEqual([
      ['first', 1],
      ['second', 2]
    ])
    expect(suite.tests[1].title).toBe(
      'AfterAll (features/step-definitions/steps.ts:3) #2'
    )
  })

  it('gives a failed hook the owner does not hold a row of its own, keyed by its id', () => {
    const feature = plainFeature('pass')
    const h = harness([feature.uri])
    const fid = featureId('10.2', feature.uri, rootDir)
    h.emit('suite:start', featurePayload(fid, feature))
    const scenario = scenarioPayload(0, fid, feature, feature.scenarios[0])
    h.emit('suite:start', scenario)
    // No parentUid: the base files the hook under the open scenario, while hookSuiteUid names the feature.
    for (const uid of ['stray-1', 'stray-2']) {
      const hook = {
        type: 'hook',
        uid,
        title: 'BeforeAll',
        parent: fid,
        hookKind: 'beforeAll',
        hookSuiteUid: fid,
        file: feature.uri
      }
      h.emit('hook:start', hook)
      h.emit('hook:end', { ...hook, error: new Error(uid) })
    }
    const rows = (h.reporter.suites[fid] as SuiteStats).tests
    expect(rows.map((r) => [r.title, r.error?.message])).toEqual([
      ['BeforeAll', 'stray-1'],
      ['BeforeAll', 'stray-2']
    ])
    expect(rows[0].uid).not.toBe(rows[1].uid)
  })

  it("shows a failed scenario hook of 10.2's parallel path under its scenario", () => {
    // wireScenarioTranslator: scenario uid `scenario-${cid}-${index}`, a hook's parent is the pickle id.
    const feature = plainFeature('pass')
    const scenarioSpec = feature.scenarios[0]
    const h = harness([feature.uri])
    const fid = featureId('10.2', feature.uri, rootDir)
    const scenarioUid = `scenario-${CID}-0`
    const contextId = 'context-0'
    h.emit('suite:start', { ...featurePayload(fid, feature), parentUid: null })
    const scenario = {
      ...scenarioPayload(0, fid, feature, scenarioSpec),
      uid: scenarioUid,
      contextId,
      parentUid: fid
    }
    h.emit('suite:start', scenario)
    const hook = {
      type: 'hook',
      uid: 'test-step-hook-1',
      title: '',
      parent: 'pickle-uuid-1',
      file: feature.uri,
      tags: [],
      featureName: feature.title,
      scenarioName: scenarioSpec.title,
      contextId,
      parentUid: scenarioUid,
      hookKind: 'beforeEach'
    }
    h.emit('hook:start', hook)
    const { contextId: _omitted, ...hookEnd } = hook
    h.emit('hook:end', {
      ...hookEnd,
      state: 'FAILED',
      error: new Error('Before failed'),
      duration: 1
    })
    h.emit('suite:end', scenario)

    const rows = (h.reporter.suites[scenarioUid] as SuiteStats).tests
    expect(rows.map((r) => [r.title, r.state, r.parent])).toEqual([
      ['Before', 'failed', scenarioUid]
    ])
  })

  it('sends a retried scenario without the failed Before of its first attempt', () => {
    const feature = plainFeature('pass')
    const scenarioSpec = feature.scenarios[0]
    const h = harness([feature.uri])
    const fid = featureId('10.2', feature.uri, rootDir)
    h.emit('suite:start', featurePayload(fid, feature))
    const scenario = scenarioPayload(0, fid, feature, scenarioSpec)
    h.emit('suite:start', scenario)
    const hook = {
      type: 'hook',
      uid: 'hook-step-1',
      title: '',
      parent: '0',
      file: feature.uri,
      hookKind: 'beforeEach'
    }
    h.emit('hook:start', hook)
    h.emit('hook:end', { ...hook, state: 'FAILED', error: new Error('flaky') })
    h.emit('suite:retry', scenario)
    h.emit('hook:start', hook)
    h.emit('hook:end', { ...hook, state: 'PASSED' })
    runSteps(h, 0, feature, scenarioSpec, scenarioSpec.steps)
    h.emit('suite:end', scenario)

    const [tree] = sentFeatures(h.report)
    const sent = h.reporter.suites['0'] as SuiteStats
    // `retries` is what tells the dashboard to drop the earlier attempt's rows (app suite-merge).
    expect(sent.retries).toBe(1)
    expect(tree.suites[0].tests.map((t) => t.state)).toEqual([
      'passed',
      'passed',
      'passed'
    ])
  })
})

describe('retried attempts (test:retry)', () => {
  it('a retried Cucumber step: the last attempt keeps its rows, the scenario counts the retry', () => {
    const feature = plainFeature('pass')
    const scenarioSpec = feature.scenarios[0]
    const h = harness([feature.uri])
    const fid = featureId('10.2', feature.uri, rootDir)
    h.emit('suite:start', featurePayload(fid, feature))
    const scenario = scenarioPayload(0, fid, feature, scenarioSpec)
    h.emit('suite:start', scenario)
    const [first, second, third] = scenarioSpec.steps
    runSteps(h, 0, feature, scenarioSpec, [
      first,
      second,
      { ...third, state: 'retry' }
    ])
    const firstAttempt = sentFeatures(h.report)[0].suites[0].tests.map(
      (t) => t.uid
    )
    h.emit('suite:retry', scenario)
    runSteps(h, 0, feature, scenarioSpec, scenarioSpec.steps)
    h.emit('suite:end', scenario)
    h.emit('suite:end', featurePayload(fid, feature))

    expect(h.onRetry).toHaveBeenCalledTimes(1)
    expect((h.onRetry.mock.calls[0][0] as TestStats).title).toBe(third.title)
    const tests = sentFeatures(h.report)[0].suites[0].tests
    expect(tests.map((t) => t.state)).toEqual(['passed', 'passed', 'passed'])
    expect(tests.map((t) => t.uid)).toEqual([
      ...firstAttempt.slice(0, 2),
      expect.any(String)
    ])
    expect(tests[2].uid).not.toBe(tests[1].uid)
    // A step's retry count is reset by its own test:end; the scenario keeps it.
    const scenarioStats = h.reporter.suites['0'] as SuiteStats
    expect(scenarioStats.retries).toBe(1)
  })

  it('a retried scenario under scenarioLevelReporter is one row, on its first uid', () => {
    const feature = plainFeature()
    const h = harness([feature.uri])
    const fid = featureId('10.2', feature.uri, rootDir)
    h.emit('suite:start', featurePayload(fid, feature))
    const scenario = scenarioPayload(0, fid, feature, feature.scenarios[0])
    h.emit('test:start', scenario)
    // CucumberFormatter.afterTest(..., retried = true) sends no test:end.
    h.emit('test:retry', {
      ...scenario,
      state: 'fail',
      passed: false,
      error: new Error('flaky')
    })
    const afterRetry = sentFeatures(h.report)[0].tests
    expect(afterRetry).toEqual([])
    h.emit('test:start', scenario)
    h.emit('test:pass', { ...scenario, state: 'pass', passed: true })
    h.emit('test:end', { ...scenario, state: 'pass', passed: true })
    h.emit('suite:end', featurePayload(fid, feature))

    const retried = h.onRetry.mock.calls[0][0] as TestStats
    const tests = sentFeatures(h.report)[0].tests
    expect(tests).toEqual([
      { uid: retried.uid, title: retried.title, state: 'passed', retries: 1 }
    ])
  })
})
