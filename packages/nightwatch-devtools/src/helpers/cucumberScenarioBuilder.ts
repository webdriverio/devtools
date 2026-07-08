import { DEFAULTS, TEST_STATE } from '../constants.js'
import type { SuiteStats } from '../types.js'
import { deterministicUid, findStepDefinitionLine } from './utils.js'

export interface CucumberScenarioBuildInput {
  /** Cucumber pickle URI — the .feature path. */
  featureUri: string
  scenarioName: string
  featureName: string
  /** Absolute file path used for callSource resolution (may be unresolved). */
  featureAbsPath?: string
  /** Step-definition files discovered for the feature (passed to find each step's source location). */
  stepDefFiles: Array<{ filePath: string; content: string }>
  /** Pickle steps as parsed by Cucumber. */
  steps: Array<{ text: string }>
  /** Per-step source line numbers from the .feature file (parsed once by the caller). */
  stepLines: number[]
  /** Per-step Gherkin keywords (Given/When/Then/And/But) parsed alongside `stepLines`. */
  stepKeywords: string[]
  /** Scenario header line number in the .feature file (0 if unresolvable). */
  scenarioLine: number
  /** Parent feature-suite uid — scenarios nest under this. */
  parentFeatureSuiteUid: string
}

/**
 * Build a fully-populated scenario sub-suite (with its `tests` array of step
 * TestStats entries) for one Cucumber scenario. Pure factory — no side effects;
 * the caller decides whether to push into the feature suite or replace an
 * existing entry (retry case).
 *
 * Extracted from `NightwatchDevToolsPlugin.#initCucumberScenario` — the
 * scenario+steps construction was ~70 lines of object-literal building that
 * doesn't touch plugin state.
 */
function buildScenarioStepTest(
  input: CucumberScenarioBuildInput,
  scenarioUid: string,
  i: number
): SuiteStats['tests'][number] {
  const {
    featureUri,
    scenarioName,
    featureAbsPath,
    stepDefFiles,
    steps,
    stepLines,
    stepKeywords
  } = input
  const step = steps[i]
  const keyword = stepKeywords[i] || ''
  const stepLabel = keyword ? `${keyword} ${step.text}` : step.text
  const stepDefLoc = findStepDefinitionLine(stepDefFiles, step.text)
  const callSource = stepDefLoc
    ? `${stepDefLoc.filePath}:${stepDefLoc.line}`
    : featureAbsPath && stepLines[i] > 0
      ? `${featureAbsPath}:${stepLines[i]}`
      : undefined
  return {
    // Scope by the scenario uid (which carries the scenario line) so identical
    // step text in sibling scenarios and outline example rows stays distinct.
    uid: deterministicUid(featureUri, `step:${scenarioUid}:${step.text}`),
    cid: DEFAULTS.CID,
    title: stepLabel,
    fullTitle: `${scenarioName} ${stepLabel}`,
    parent: scenarioUid,
    state: TEST_STATE.PENDING,
    start: new Date(),
    end: null,
    type: 'test' as const,
    file: featureUri,
    retries: 0,
    _duration: 0,
    hooks: [],
    callSource
  }
}

export function buildCucumberScenarioSuite(
  input: CucumberScenarioBuildInput
): SuiteStats {
  const {
    featureUri,
    scenarioName,
    featureName,
    featureAbsPath,
    steps,
    scenarioLine,
    parentFeatureSuiteUid
  } = input
  // deterministicUid (no counter) so the SAME scenario gets the SAME uid
  // across retries — that's what makes retry-coalescing work upstream. The
  // scenario line disambiguates outline example rows that share a name.
  const scenarioUid = deterministicUid(
    featureUri,
    `scenario:${scenarioName}:${scenarioLine}`
  )
  const scenarioSuite: SuiteStats = {
    uid: scenarioUid,
    cid: DEFAULTS.CID,
    title: scenarioName,
    fullTitle: `${featureName} ${scenarioName}`,
    parent: parentFeatureSuiteUid,
    type: 'suite' as const,
    file: featureUri,
    start: new Date(),
    state: TEST_STATE.RUNNING,
    end: null,
    tests: [],
    suites: [],
    hooks: [],
    _duration: 0,
    callSource:
      featureAbsPath && scenarioLine > 0
        ? `${featureAbsPath}:${scenarioLine}`
        : undefined
  }
  for (let i = 0; i < steps.length; i++) {
    scenarioSuite.tests.push(buildScenarioStepTest(input, scenarioUid, i))
  }
  return scenarioSuite
}
