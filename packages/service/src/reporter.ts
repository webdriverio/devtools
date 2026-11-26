import WebdriverIOReporter, {
  type HookStats,
  type RunnerStats,
  type SuiteStats,
  type TestStats
} from '@wdio/reporter'
import type { Reporters } from '@wdio/types'
import {
  deterministicUid,
  generateStableUid as generateStableUidByFileName,
  resetSignatureCounters
} from '@wdio/devtools-core'
import { FEATURE_FILE_RE } from '@wdio/devtools-shared'
import {
  mapTestToSource,
  setCurrentSpecFile,
  mapSuiteToSource
} from './utils.js'
import {
  attemptKey,
  declarationAt,
  descendants,
  exampleLine,
  failedHookRow,
  isCucumberSuite,
  orderLast,
  readFeatureScenarios
} from './reporter-helpers.js'
import type { FeatureScenario } from './types.js'
import { specFileAttemptOf } from './test-metadata.js'

// True when the stats object is a Cucumber scenario. The `type` field on
// @wdio/reporter's SuiteStats/TestStats is a literal union ('suite' | 'test'),
// but WDIO's Cucumber adapter ALSO emits `type: 'scenario'`. Module
// augmentation can't widen the literal, so we widen at the read site here.
function isScenario(item: SuiteStats | TestStats): boolean {
  return (item as { type?: string }).type === 'scenario'
}

// Generate stable UID for a WDIO suite/test stats object. Handles WDIO's
// Cucumber-specific shapes (scenarios with featureFile/featureLine, or with
// numeric uid + example-row fallback), then delegates the Mocha/Jasmine path
// to core's generateStableUid. `parentScope` (the owning scenario's stable
// uid) disambiguates Cucumber steps so identical step text in sibling
// scenarios yields distinct, rerun-stable uids. `scenarioKey` is a
// scenario's own line read from its feature file, or its position among
// same-titled pickles when the file cannot be read.
function generateStableUid(
  item: SuiteStats | TestStats,
  {
    parentScope,
    inFeatureFile = false,
    scenarioKey
  }: {
    parentScope?: string
    inFeatureFile?: boolean
    scenarioKey?: string
  } = {}
): string {
  // For Cucumber scenarios, prefer the feature file URI:line as the stable
  // discriminator. The Cucumber pickle carries the actual line of the example
  // row, which is stable across reruns regardless of how many examples run.
  // The previous fallback used WDIO's index-based uid (`example-${item.uid}`),
  // but that uid is reassigned when running a subset of examples — e.g. running
  // only example 2 alone makes it example index 0, colliding with example 1's
  // stable UID from a full run and causing duplicate rows in the dashboard.
  if (
    isScenario(item) &&
    item.featureFile &&
    typeof item.featureLine === 'number'
  ) {
    return deterministicUid(
      item.featureFile,
      String(item.featureLine),
      item.title
    )
  }

  // Fallback for Cucumber scenarios where the pickle URI:line wasn't captured.
  // Only the scenario's own properties: the worker slot and pickle index change with the run's selection.
  if (isScenario(item) && /^\d+$/.test(item.uid)) {
    const file = 'file' in item ? (item.file ?? '') : ''
    return deterministicUid(file, scenarioKey ?? '', item.title)
  }

  // Cucumber step: scope by the owning scenario's stable uid via
  // deterministicUid (no run-order counter), so two scenarios sharing step
  // text — and scenario-outline example rows — get distinct, rerun-stable uids.
  const stepFile = 'file' in item ? (item.file ?? '') : ''
  if (parentScope) {
    return deterministicUid(
      stepFile,
      parentScope,
      String(item.fullTitle || item.title)
    )
  }

  // Mocha/Jasmine, and a `scenarioLevelReporter` scenario by title (its fullTitle holds the feature id); never cid or parent.
  const name = inFeatureFile ? item.title : item.fullTitle || item.title
  return generateStableUidByFileName(stepFile, String(name))
}

export class TestReporter extends WebdriverIOReporter {
  #report: (data: Record<string, SuiteStats>[]) => void
  #loadSource: (location: string) => void
  #onRetry: (testStats: TestStats) => void
  /** Stable uid of each retried test, which its next attempt takes over. */
  #retriedUids = new Map<string, string>()
  #currentSpecFile?: string
  #suitePath: string[] = []
  /** Stable uid of the Cucumber scenario currently open, used to scope its
   *  step uids. Undefined outside a scenario (Mocha/Jasmine). */
  #currentScenarioUid?: string
  /** Pickle index of the first example seen of each outline, keyed by file and outline line. */
  #outlineStarts = new Map<string, number>()
  /** Pickle indices seen for each file and scenario title, in the order they started. */
  #titledPickles = new Map<string, number[]>()

  #onSpecFileAttempt: (attempt: number) => void

  constructor(
    options: Reporters.Options,
    report: (data: Record<string, SuiteStats>[]) => void,
    loadSource: (location: string) => void = () => {},
    onRetry: (testStats: TestStats) => void = () => {},
    onSpecFileAttempt: (attempt: number) => void = () => {}
  ) {
    super(options)
    this.#report = report
    this.#loadSource = loadSource
    this.#onSpecFileAttempt = onSpecFileAttempt
    this.#onRetry = onRetry
    // Reset signature counters for each new reporter instance (new test run)
    resetSignatureCounters()
  }

  onRunnerStart(runnerStats: RunnerStats): void {
    super.onRunnerStart(runnerStats)
    this.#onSpecFileAttempt(specFileAttemptOf(runnerStats))
  }

  onSuiteStart(suiteStats: SuiteStats): void {
    super.onSuiteStart(suiteStats)

    // For Cucumber scenarios: prefer the pickle's URI:line (stable across
    // single-example reruns). Fall back to index-based feature-file parsing
    // only if the pickle data isn't available.
    let scenarioKey: string | undefined
    if (isScenario(suiteStats) && suiteStats.file?.endsWith('.feature')) {
      const cucumberArg = (suiteStats as { argument?: unknown }).argument as
        { uri?: string; line?: number } | undefined
      const pickleUri =
        cucumberArg?.uri ?? suiteStats.pickle?.uri ?? suiteStats.uri
      const pickleLine =
        cucumberArg?.line ??
        suiteStats.pickle?.location?.line ??
        (typeof suiteStats.line === 'number' ? suiteStats.line : undefined)
      if (typeof pickleUri === 'string' && typeof pickleLine === 'number') {
        suiteStats.featureFile = pickleUri
        suiteStats.featureLine = pickleLine
      } else {
        scenarioKey = this.#resolveFeatureLines(suiteStats, suiteStats.file)
      }
    }

    // Generate stable UID for consistent identification across reruns
    suiteStats.uid = generateStableUid(suiteStats, { scenarioKey })

    // Track the open Cucumber scenario so its steps scope their uids to it.
    if (isScenario(suiteStats)) {
      this.#currentScenarioUid = suiteStats.uid
    }

    this.#currentSpecFile = suiteStats.file
    setCurrentSpecFile(suiteStats.file)

    // Push title if non-empty
    if (suiteStats.title) {
      this.#suitePath.push(suiteStats.title)
    }

    // Enrich and set callSource for suites
    mapSuiteToSource(suiteStats, this.#currentSpecFile, this.#suitePath)
    if (suiteStats.file) {
      // loadSource only needs the file path — line is irrelevant for fetching
      // the source. Fire whenever there's a file mapping, even if line is unset
      // (e.g. cucumber feature suites where the line comes from pickle data
      // populated later).
      this.#loadSource(suiteStats.file)
      if (suiteStats.line !== null && suiteStats.line !== undefined) {
        suiteStats.callSource = `${suiteStats.file}:${suiteStats.line}`
      }
    }

    this.#sendUpstream()
  }

  // Sets an example's row line and returns the scenario's own; WDIO's uid is a position among every pickle, so examples count from their outline's first.
  #resolveFeatureLines(
    suiteStats: SuiteStats | TestStats,
    file: string
  ): string | undefined {
    const pickleIndex = parseInt(suiteStats.uid, 10)
    if (isNaN(pickleIndex)) {
      return undefined
    }
    const ordinal = this.#titleOrdinal(file, suiteStats.title, pickleIndex)
    const scenario = declarationAt(
      readFeatureScenarios(file, suiteStats.title),
      suiteStats.title,
      ordinal
    )
    if (!scenario) {
      // A file the parser cannot read (a non-English keyword, say) still keeps same-titled pickles apart.
      return `#${ordinal}`
    }
    const line = exampleLine(
      scenario,
      suiteStats.title,
      pickleIndex - this.#outlineStart(file, scenario, pickleIndex)
    )
    if (line !== undefined) {
      suiteStats.featureFile = file
      suiteStats.featureLine = line
    }
    return String(scenario.line)
  }

  // Same-titled pickles run in file order; a retry reuses its pickle index, so it keeps its position.
  #titleOrdinal(file: string, title: string, pickleIndex: number): number {
    const key = `${file}\0${title}`
    const seen = this.#titledPickles.get(key) ?? []
    if (!seen.includes(pickleIndex)) {
      seen.push(pickleIndex)
    }
    this.#titledPickles.set(key, seen)
    return seen.indexOf(pickleIndex)
  }

  #outlineStart(
    file: string,
    scenario: FeatureScenario,
    pickleIndex: number
  ): number {
    const key = `${file}:${scenario.line}`
    const start = this.#outlineStarts.get(key) ?? pickleIndex
    this.#outlineStarts.set(key, start)
    return start
  }

  onTestStart(testStats: TestStats): void {
    super.onTestStart(testStats)
    const inFeatureFile = FEATURE_FILE_RE.test(testStats.file ?? '')

    // For Cucumber: capture feature file URI and line from pickle
    const cucumberArg = (testStats as { argument?: unknown }).argument as
      { uri?: string; line?: number } | undefined
    if (cucumberArg?.uri && typeof cucumberArg.line === 'number') {
      testStats.featureFile = cucumberArg.uri
      testStats.featureLine = cucumberArg.line
    }

    // Enrich testStats with callSource info FIRST
    mapTestToSource(testStats, this.#currentSpecFile)
    if (
      testStats.file &&
      testStats.line !== null &&
      testStats.line !== undefined
    ) {
      testStats.callSource = `${testStats.file}:${testStats.line}`
      this.#loadSource(testStats.file)
    }

    // Generate stable UID after enriching metadata for consistent test
    // identification. Cucumber steps are scoped by their scenario's uid so
    // identical step text across scenarios stays distinct.
    const retryKey = attemptKey(testStats)
    const retriedUid = this.#retriedUids.get(retryKey)
    this.#retriedUids.delete(retryKey)
    // A `scenarioLevelReporter` scenario is a test, and needs the lines a scenario suite gets.
    const scenarioKey =
      isScenario(testStats) &&
      testStats.file &&
      inFeatureFile &&
      testStats.featureLine === undefined
        ? this.#resolveFeatureLines(testStats, testStats.file)
        : undefined
    testStats.uid =
      retriedUid ??
      generateStableUid(testStats, {
        parentScope: this.#currentScenarioUid,
        inFeatureFile,
        scenarioKey
      })

    this.#sendUpstream()
  }

  onTestEnd(testStats: TestStats): void {
    super.onTestEnd(testStats)
    // Normalize the error to a plain object so its fields survive JSON
    // serialization over the WebSocket. Error instances have message/name/
    // stack as non-enumerable, so JSON.stringify would drop them. We also
    // explicitly capture assertion-library extras (`expected`, `actual`,
    // `matcherResult`) — Jest/expect-webdriverio may attach these as either
    // enumerable or non-enumerable depending on version, so we access them
    // by name rather than relying on spread.
    const rawErr = testStats.error as
      | (Error & {
          expected?: unknown
          actual?: unknown
          matcherResult?: unknown
        })
      | undefined
    if (rawErr) {
      testStats.error = {
        ...rawErr,
        message: rawErr.message,
        name: rawErr.name,
        stack: rawErr.stack,
        expected: rawErr.expected,
        actual: rawErr.actual,
        matcherResult: rawErr.matcherResult
      } as Error
    }
    // WDIO stamps the 0-based attempt on each test:start, so the final attempt's
    // stat already carries the retry count; the field is optional upstream, so
    // pin it to a number for the shared TestStats.retries contract.
    testStats.retries = testStats.retries ?? 0
    this.#sendUpstream()
  }

  // The retried attempt's row gives way to the next attempt, which keeps its uid.
  onTestRetry(testStats: TestStats): void {
    super.onTestRetry(testStats)
    this.#retriedUids.set(attemptKey(testStats), testStats.uid)
    const suite = Object.values(this.suites).find((s) =>
      s?.tests.includes(testStats)
    )
    if (suite) {
      suite.tests = suite.tests.filter((t) => t !== testStats)
    }
    this.#onRetry(testStats)
    this.#sendUpstream()
  }

  // A failed Cucumber hook fails no step, so without a row of its own it shows nowhere.
  onHookEnd(hookStats: HookStats): void {
    super.onHookEnd(hookStats)
    const error = hookStats.error ?? hookStats.errors?.[0]
    if (!error || hookStats.failedTestUid) {
      return
    }
    // In 10.2's parallel path a scenario hook's `parent` is the pickle id; only `parentUid` names the scenario's suite.
    const ownerUid =
      hookStats.parentUid ?? hookStats.hookSuiteUid ?? hookStats.parent
    const owner = this.suites[ownerUid]
    if (!isCucumberSuite(owner)) {
      return
    }
    const row = failedHookRow(hookStats, owner, ownerUid, error)
    owner.tests.push(row)
    if (hookStats.hookKind === 'afterAll') {
      orderLast(owner, row)
    }
    this.#sendUpstream()
  }

  onSuiteEnd(suiteStats: SuiteStats): void {
    super.onSuiteEnd(suiteStats)
    // Stop scoping steps once the owning scenario closes.
    if (isScenario(suiteStats) && suiteStats.uid === this.#currentScenarioUid) {
      this.#currentScenarioUid = undefined
    }
    // Pop the suite we pushed on start
    if (
      suiteStats.title &&
      this.#suitePath[this.#suitePath.length - 1] === suiteStats.title
    ) {
      this.#suitePath.pop()
    }
    // Only clear when the last suite ends
    if (this.#suitePath.length === 0) {
      this.#currentSpecFile = undefined
      setCurrentSpecFile(undefined)
    }
    this.#sendUpstream()
  }

  #sendUpstream() {
    if (!this.suites) {
      return
    }

    const payload: Record<string, SuiteStats>[] = []

    // Use the suite's current UID (which we've set to stable) as the key.
    // The tree too: on 9.x a second same-named feature replaces the first in `this.suites`.
    const listed = new Set<SuiteStats>()
    for (const suite of [
      ...Object.values(this.suites),
      ...descendants(this.currentSuites[0])
    ]) {
      if (suite && !listed.has(suite)) {
        listed.add(suite)
        payload.push({ [suite.uid]: suite })
      }
    }

    if (payload.length > 0) {
      this.#report(payload)
    }
  }

  get report() {
    return this.suites
  }
}
