import WebdriverIOReporter, {
  type SuiteStats,
  type TestStats
} from '@wdio/reporter'
import {
  deterministicUid,
  generateStableUid as generateStableUidByFileName,
  resetSignatureCounters
} from '@wdio/devtools-core'
import {
  mapTestToSource,
  setCurrentSpecFile,
  mapSuiteToSource
} from './utils.js'
import { readFileSync, existsSync } from 'node:fs'

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
// to core's generateStableUid.
function generateStableUid(item: SuiteStats | TestStats): string {
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
  if (isScenario(item) && /^\d+$/.test(item.uid)) {
    const file = 'file' in item ? (item.file ?? '') : ''
    const parent = 'parent' in item ? (item.parent ?? '') : ''
    return deterministicUid(
      item.title,
      file,
      parent,
      item.cid || '',
      `example-${item.uid}`
    )
  }

  // For Mocha/Jasmine tests and suites, use only stable identifiers
  // that don't change between full and partial runs
  // DO NOT use cid or parent as they can vary based on run context
  const file = 'file' in item ? (item.file ?? '') : ''
  return generateStableUidByFileName(file, String(item.fullTitle || item.title))
}

/**
 * Parse a Cucumber feature file to extract line numbers for scenario outline examples
 * Returns a map of example index -> line number
 */
function parseFeatureFileForExampleLines(
  filePath: string,
  scenarioTitle: string
): Map<number, number> | null {
  try {
    if (!existsSync(filePath)) {
      return null
    }

    const content = readFileSync(filePath, 'utf-8')
    const lines = content.split('\n')

    // Find the scenario outline with matching title
    let scenarioLineIndex = -1
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim()
      if (
        (line.startsWith('Scenario Outline:') ||
          line.startsWith('Scenario:')) &&
        line.includes(scenarioTitle)
      ) {
        scenarioLineIndex = i
        break
      }
    }

    if (scenarioLineIndex === -1) {
      return null
    }

    // Find the Examples section
    let examplesStartIndex = -1
    for (let i = scenarioLineIndex; i < lines.length; i++) {
      if (lines[i].trim().startsWith('Examples:')) {
        examplesStartIndex = i
        break
      }
    }

    if (examplesStartIndex === -1) {
      return null
    }

    // Find the data rows (skip header row with |)
    const exampleLines = new Map<number, number>()
    let exampleIndex = 0
    let foundHeader = false

    for (let i = examplesStartIndex + 1; i < lines.length; i++) {
      const line = lines[i].trim()

      // Stop at next scenario or feature end
      if (
        line.startsWith('Scenario') ||
        line.startsWith('Feature:') ||
        (!line && exampleIndex > 0)
      ) {
        break
      }

      // Data rows start with |
      if (line.startsWith('|')) {
        if (!foundHeader) {
          foundHeader = true // Skip header row
        } else {
          // Store line number (1-indexed)
          exampleLines.set(exampleIndex, i + 1)
          exampleIndex++
        }
      }
    }

    return exampleLines.size > 0 ? exampleLines : null
  } catch (error) {
    console.error('[Reporter] Failed to parse feature file:', error)
    return null
  }
}

export class TestReporter extends WebdriverIOReporter {
  #report: (data: any) => void
  #loadSource: (location: string) => void
  #currentSpecFile?: string
  #suitePath: string[] = []

  constructor(
    options: any,
    report: (data: any) => void,
    loadSource: (location: string) => void = () => {}
  ) {
    super(options)
    this.#report = report
    this.#loadSource = loadSource
    // Reset signature counters for each new reporter instance (new test run)
    resetSignatureCounters()
  }

  onSuiteStart(suiteStats: SuiteStats): void {
    super.onSuiteStart(suiteStats)

    // For Cucumber scenarios: prefer the pickle's URI:line (stable across
    // single-example reruns). Fall back to index-based feature-file parsing
    // only if the pickle data isn't available.
    if (isScenario(suiteStats) && suiteStats.file?.endsWith('.feature')) {
      const cucumberArg = (suiteStats as { argument?: unknown }).argument as
        | { uri?: string; line?: number }
        | undefined
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
        const exampleIndex = parseInt(suiteStats.uid, 10)
        if (!isNaN(exampleIndex)) {
          const exampleLines = parseFeatureFileForExampleLines(
            suiteStats.file,
            suiteStats.title
          )
          if (exampleLines?.has(exampleIndex)) {
            const lineNumber = exampleLines.get(exampleIndex)!
            suiteStats.featureFile = suiteStats.file
            suiteStats.featureLine = lineNumber
          }
        }
      }
    }

    // Generate stable UID for consistent identification across reruns
    suiteStats.uid = generateStableUid(suiteStats)

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

  onTestStart(testStats: TestStats): void {
    super.onTestStart(testStats)

    // For Cucumber: capture feature file URI and line from pickle
    const cucumberArg = (testStats as { argument?: unknown }).argument as
      | { uri?: string; line?: number }
      | undefined
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

    // Generate stable UID after enriching metadata for consistent test identification
    testStats.uid = generateStableUid(testStats)

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
    this.#sendUpstream()
  }

  onSuiteEnd(suiteStats: SuiteStats): void {
    super.onSuiteEnd(suiteStats)
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

    // Use the suite's current UID (which we've set to stable) as the key
    for (const suite of Object.values(this.suites)) {
      if (suite) {
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
