/**
 * Cucumber lifecycle for the Nightwatch plugin.
 *
 * Extracted from the plugin class to keep `index.ts` under the file-size cap
 * and to isolate the cucumber-specific orchestration from the per-test
 * (Mocha/Jasmine-style) lifecycle.
 *
 * The plugin passes itself as a `CucumberLifecycleCtx` — a narrow interface
 * exposing only the fields and methods this module needs. The lifecycle
 * helpers mutate the plugin's "current execution" state via the accessors on
 * the ctx (they can't reach the plugin's private fields directly).
 */

import logger from '@wdio/logger'
import { errorMessage } from '@wdio/devtools-core'
import { WS_SCOPE } from '@wdio/devtools-shared'

import type { SessionCapturer } from './session.js'
import type { TestReporter } from './reporter.js'
import type { TestManager } from './helpers/testManager.js'
import type { SuiteManager } from './helpers/suiteManager.js'
import type { BrowserProxy } from './helpers/browserProxy.js'
import type { NightwatchBrowser, SuiteStats, TestStats } from './types.js'
import { TEST_STATE } from './constants.js'
import {
  closeOpenSteps,
  cucumberResultToTestState
} from './helpers/cucumberResult.js'
import { buildCucumberScenarioSuite } from './helpers/cucumberScenarioBuilder.js'
import { scanFeatureFile } from './helpers/featureFileScan.js'
import { parseCucumberScenario } from './helpers/utils.js'

const log = logger('@wdio/nightwatch-devtools:cucumber')

/** Minimal shapes for the Cucumber objects we touch. Cucumber's own types
 *  vary across major versions; we pin only fields we read. */
export interface CucumberPickleStep {
  text?: string
  astNodeIds?: string[]
  location?: { line?: number }
}
export interface CucumberPickle {
  uri?: string
  name?: string
  location?: { line?: number }
  astNodeIds?: string[]
  steps?: CucumberPickleStep[]
}
export interface CucumberResult {
  status?: string
}

export interface CucumberLifecycleCtx {
  readonly sessionCapturer: SessionCapturer
  readonly testReporter: TestReporter
  readonly testManager: TestManager
  readonly suiteManager: SuiteManager
  readonly browserProxy: BrowserProxy | undefined
  setCucumberRunner(v: boolean): void
  ensureSessionInitialized(browser: NightwatchBrowser): Promise<void>
  wrapBrowserOnce(browser: NightwatchBrowser): void
  incrementCount(state: TestStats['state']): void
  testIcon(state: TestStats['state']): string
  getCurrentScenarioSuite(): SuiteStats | null
  setCurrentScenarioSuite(s: SuiteStats | null): void
  setCurrentStep(s: unknown): void
  getCurrentStep(): unknown
  setCurrentTest(t: unknown): void
}

type MutStep = {
  title?: string
  state?: string
  start?: Date | null
  end?: Date | null
  _duration?: number
}

function attachScenarioToFeature(
  ctx: CucumberLifecycleCtx,
  featureSuite: SuiteStats,
  scenarioSuite: SuiteStats
): void {
  // If a suite with this uid already exists, this is a RETRY of the same
  // scenario — clear execution data so only the latest attempt shows.
  const existingIdx = featureSuite.suites.findIndex(
    (s: SuiteStats) => s.uid === scenarioSuite.uid
  )
  if (existingIdx !== -1) {
    featureSuite.suites[existingIdx] = scenarioSuite
    // Pass the specific scenario uid so only this scenario's execution data
    // is reset — a uid-less clearExecutionData would mark ALL suites as
    // running, destroying the previous terminal states of sibling scenarios.
    ctx.sessionCapturer.sendUpstream(WS_SCOPE.clearExecutionData, {
      uid: scenarioSuite.uid,
      entryType: 'suite'
    })
  } else {
    featureSuite.suites.push(scenarioSuite)
  }
}

function createFeatureSuite(
  ctx: CucumberLifecycleCtx,
  featureUri: string,
  featureName: string,
  featureContent: string,
  featureAbsPath: string,
  scenarioName: string,
  steps: Array<{ text: string }>
): {
  featureSuite: SuiteStats
  scenarioLine: number
  stepLines: number[]
  stepKeywords: string[]
} {
  const featureSuite = ctx.suiteManager.getOrCreateSuite(
    featureUri,
    featureName,
    featureUri,
    []
  )
  ctx.suiteManager.markSuiteAsRunning(featureSuite)
  const { featureLine, scenarioLine, stepLines, stepKeywords } =
    parseCucumberScenario(
      featureContent,
      scenarioName,
      steps.map((s) => s.text)
    )
  if (featureAbsPath && featureLine > 0) {
    featureSuite.callSource = `${featureAbsPath}:${featureLine}`
  }
  return { featureSuite, scenarioLine, stepLines, stepKeywords }
}

function normalizeSteps(
  pickleSteps: CucumberPickleStep[] | undefined
): Array<{ text: string }> {
  return (pickleSteps ?? []).map((s) => ({ text: s.text ?? '' }))
}

export async function initCucumberScenario(
  ctx: CucumberLifecycleCtx,
  browser: NightwatchBrowser,
  pickle: CucumberPickle
): Promise<void> {
  await ctx.ensureSessionInitialized(browser)
  const featureUri: string = pickle.uri ?? 'unknown.feature'
  const scenarioName: string = pickle.name ?? 'Unknown Scenario'
  const steps = normalizeSteps(pickle.steps)
  const {
    featureName,
    featureContent,
    featureAbsPath,
    stepDefFiles,
    capturedPaths
  } = scanFeatureFile(featureUri)
  for (const p of capturedPaths) {
    ctx.sessionCapturer.captureSource(p).catch(() => {})
  }
  const { featureSuite, scenarioLine, stepLines, stepKeywords } =
    createFeatureSuite(
      ctx,
      featureUri,
      featureName,
      featureContent,
      featureAbsPath,
      scenarioName,
      steps
    )
  const scenarioSuite = buildCucumberScenarioSuite({
    featureUri,
    scenarioName,
    featureName,
    featureAbsPath,
    stepDefFiles,
    steps,
    stepLines,
    stepKeywords,
    scenarioLine,
    parentFeatureSuiteUid: featureSuite.uid
  })
  attachScenarioToFeature(ctx, featureSuite, scenarioSuite)
  ctx.setCurrentScenarioSuite(scenarioSuite)
  ctx.setCurrentStep(null)
  ctx.setCurrentTest(null)
  ctx.testReporter.updateSuites()
  ctx.wrapBrowserOnce(browser)
  log.info(`🥒 Scenario: ${scenarioName}`)
}

export async function finalizeCucumberScenario(
  ctx: CucumberLifecycleCtx,
  browser: NightwatchBrowser,
  result: CucumberResult,
  pickle: CucumberPickle | undefined
): Promise<void> {
  try {
    const scenarioState = cucumberResultToTestState(result)
    const scenario = ctx.getCurrentScenarioSuite()
    if (scenario) {
      const now = new Date()
      const duration =
        now.getTime() - (scenario.start?.getTime() ?? now.getTime())
      scenario.state = scenarioState
      scenario.end = now
      scenario._duration = duration
      closeOpenSteps(scenario, scenarioState, now)

      const featureUri: string = pickle?.uri ?? 'unknown.feature'
      ctx.testManager.markTestAsProcessed(featureUri, pickle?.name ?? '')

      const featureSuite = ctx.suiteManager.getSuite(featureUri)
      if (featureSuite) {
        // Finalize is not called until all scenarios are done — just update state.
        ctx.suiteManager.finalizeSuiteState(featureSuite)
      }

      ctx.incrementCount(scenarioState)
      const icon = ctx.testIcon(scenarioState)
      log.info(
        `  ${icon} ${pickle?.name ?? 'Unknown'} (${(duration / 1000).toFixed(2)}s)`
      )

      ctx.testReporter.updateSuites()
      ctx.setCurrentScenarioSuite(null)
      ctx.setCurrentStep(null)
      ctx.setCurrentTest(null)
    }
    await ctx.sessionCapturer.captureTrace(browser)
  } catch (err) {
    log.error(`Failed to finalize Cucumber scenario: ${errorMessage(err)}`)
  }
}

export async function cucumberBeforeStep(
  ctx: CucumberLifecycleCtx,
  _browser: NightwatchBrowser,
  pickleStep: CucumberPickleStep,
  _pickle: CucumberPickle
): Promise<void> {
  const scenario = ctx.getCurrentScenarioSuite()
  if (!scenario) {
    return
  }
  // Reset per-step dedup tracking so commands in step N are never
  // mistaken for retries of identically-signatured commands from step N-1.
  ctx.browserProxy?.resetCommandTracking()

  const stepText: string = pickleStep?.text ?? ''
  const step = (scenario.tests as Array<MutStep | string>).find(
    (t): t is MutStep =>
      typeof t !== 'string' &&
      (t.title?.endsWith(stepText) === true || t.title === stepText)
  )
  if (step) {
    step.state = TEST_STATE.RUNNING
    step.start = new Date()
    step.end = null
    ctx.setCurrentStep(step)
    ctx.testReporter.updateSuites()
  }
}

export async function cucumberAfterStep(
  ctx: CucumberLifecycleCtx,
  _browser: NightwatchBrowser,
  result: CucumberResult,
  pickleStep: CucumberPickleStep,
  _pickle: CucumberPickle
): Promise<void> {
  const step = ctx.getCurrentStep() as MutStep | null
  if (!step) {
    return
  }
  const status = String(result?.status ?? 'UNKNOWN').toUpperCase()
  const stepState: TestStats['state'] =
    status === 'PASSED'
      ? TEST_STATE.PASSED
      : status === 'SKIPPED'
        ? TEST_STATE.SKIPPED
        : TEST_STATE.FAILED
  step.state = stepState
  step.end = new Date()
  step._duration = Date.now() - (step.start?.getTime() ?? Date.now())
  ctx.setCurrentStep(null)
  ctx.testReporter.updateSuites()
  void pickleStep
}

export async function cucumberBefore(
  ctx: CucumberLifecycleCtx,
  browser: NightwatchBrowser,
  pickle: CucumberPickle
): Promise<void> {
  ctx.setCucumberRunner(true)
  await initCucumberScenario(ctx, browser, pickle)
}

export async function cucumberAfter(
  ctx: CucumberLifecycleCtx,
  browser: NightwatchBrowser,
  result: CucumberResult,
  pickle: CucumberPickle
): Promise<void> {
  await finalizeCucumberScenario(ctx, browser, result, pickle)
}
