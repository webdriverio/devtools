import WebdriverIOReporter, {
  type SuiteStats,
  type TestStats
} from '@wdio/reporter'
import {
  mapTestToSource,
  setCurrentSpecFile,
  mapSuiteToSource
} from './utils.js'
import { readFileSync, existsSync } from 'node:fs'

// Store Cucumber pickle/scenario line numbers captured from hooks
// Key format: "cid:title" or "cid:uid"
const cucumberScenarioLines = new Map<string, { uri: string; line: number }>()

export function setCucumberScenarioLine(key: string, uri: string, line: number) {
  cucumberScenarioLines.set(key, { uri, line })
}

export function getCucumberScenarioLine(key: string) {
  return cucumberScenarioLines.get(key)
}

export function clearCucumberScenarioLines() {
  cucumberScenarioLines.clear()
}

// Track test/suite occurrences within current run to handle duplicate signatures
// (e.g., Cucumber Scenario Outline example rows)
const signatureCounters = new Map<string, number>()

// Generate stable UID based on test/suite metadata
function generateStableUid(item: SuiteStats | TestStats): string {
  const rawItem = item as any

  // For Cucumber scenarios with numeric UIDs (example indices), use them directly
  // to ensure consistent UIDs across reruns
  if (rawItem.type === 'scenario' && /^\d+$/.test(rawItem.uid)) {
    const parts = [
      item.title,
      rawItem.file || '',
      rawItem.parent || '',
      rawItem.cid || '',
      // Use original UID (example index) to ensure stable identification
      `example-${rawItem.uid}`
    ]
    const hash = parts.join('::').split('').reduce((acc, char) => {
      return ((acc << 5) - acc + char.charCodeAt(0)) | 0
    }, 0)
    return `stable-${Math.abs(hash).toString(36)}`
  }

  // For Mocha/Jasmine tests and suites, use only stable identifiers
  // that don't change between full and partial runs
  // DO NOT use cid or parent as they can vary based on run context
  const parts = [
    rawItem.file || '',
    String(rawItem.fullTitle || item.title)
  ]

  const signature = parts.join('::')
  const count = signatureCounters.get(signature) || 0
  signatureCounters.set(signature, count + 1)

  if (count > 0) {
    parts.push(String(count))
  }

  const hash = parts.join('::').split('').reduce((acc, char) => {
    return ((acc << 5) - acc + char.charCodeAt(0)) | 0
  }, 0)

  return `stable-${Math.abs(hash).toString(36)}`
}

// Reset counters at the start of each test run
function resetSignatureCounters() {
  signatureCounters.clear()
}

/**
 * Parse a Cucumber feature file to extract line numbers for scenario outline examples
 * Returns a map of example index -> line number
 */
function parseFeatureFileForExampleLines(filePath: string, scenarioTitle: string): Map<number, number> | null {
  try {
    if (!existsSync(filePath)) return null

    const content = readFileSync(filePath, 'utf-8')
    const lines = content.split('\n')

    // Find the scenario outline with matching title
    let scenarioLineIndex = -1
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim()
      if ((line.startsWith('Scenario Outline:') || line.startsWith('Scenario:')) &&
          line.includes(scenarioTitle)) {
        scenarioLineIndex = i
        break
      }
    }

    if (scenarioLineIndex === -1) return null

    // Find the Examples section
    let examplesStartIndex = -1
    for (let i = scenarioLineIndex; i < lines.length; i++) {
      if (lines[i].trim().startsWith('Examples:')) {
        examplesStartIndex = i
        break
      }
    }

    if (examplesStartIndex === -1) return null

    // Find the data rows (skip header row with |)
    const exampleLines = new Map<number, number>()
    let exampleIndex = 0
    let foundHeader = false

    for (let i = examplesStartIndex + 1; i < lines.length; i++) {
      const line = lines[i].trim()

      // Stop at next scenario or feature end
      if (line.startsWith('Scenario') || line.startsWith('Feature:') ||
          (!line && exampleIndex > 0)) {
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
  #currentSpecFile?: string
  #suitePath: string[] = []

  constructor(options: any, report: (data: any) => void) {
    super(options)
    this.#report = report
    // Reset signature counters for each new reporter instance (new test run)
    resetSignatureCounters()
  }

  onSuiteStart(suiteStats: SuiteStats): void {
    super.onSuiteStart(suiteStats)

    const rawSuite = suiteStats as any
    console.log('[Reporter] Suite started:', {
      title: suiteStats.title,
      type: suiteStats.type,
      file: suiteStats.file,
      uid: suiteStats.uid,
      fullTitle: rawSuite.fullTitle,
      parent: rawSuite.parent
    })

    // For Cucumber scenario outlines: extract feature file line number from example index
    if (rawSuite.type === 'scenario' && suiteStats.file?.endsWith('.feature')) {
      const exampleIndex = parseInt(rawSuite.uid, 10)
      if (!isNaN(exampleIndex)) {
        const exampleLines = parseFeatureFileForExampleLines(suiteStats.file, suiteStats.title)
        if (exampleLines?.has(exampleIndex)) {
          const lineNumber = exampleLines.get(exampleIndex)!
          rawSuite.featureFile = suiteStats.file
          rawSuite.featureLine = lineNumber
          console.log('[Reporter] Captured Cucumber example line:', {
            title: suiteStats.title,
            exampleIndex,
            featureFile: rawSuite.featureFile,
            featureLine: rawSuite.featureLine
          })
        }
      }
    }

    // Override with stable UID
    const stableUid = generateStableUid(suiteStats)
    ;(suiteStats as any).uid = stableUid
    console.log('[Reporter] Generated stable suite UID:', stableUid)

    this.#currentSpecFile = suiteStats.file
    setCurrentSpecFile(suiteStats.file)

    // Push title if non-empty
    if (suiteStats.title) {
      this.#suitePath.push(suiteStats.title)
    }

    // Enrich and set callSource for suites
    mapSuiteToSource(suiteStats as any, this.#currentSpecFile, this.#suitePath)
    if ((suiteStats as any).file && (suiteStats as any).line !== null) {
      ;(suiteStats as any).callSource =
        `${(suiteStats as any).file}:${(suiteStats as any).line}`
    }

    this.#sendUpstream()
  }

  onTestStart(testStats: TestStats): void {
    super.onTestStart(testStats)

    // For Cucumber: capture feature file URI and line from pickle
    const rawTest = testStats as any
    console.log('[Reporter] Test started:', {
      title: testStats.title,
      fullTitle: rawTest.fullTitle,
      argument: rawTest.argument,
      file: rawTest.file,
      line: rawTest.line
    })
    if (rawTest.argument?.uri && typeof rawTest.argument?.line === 'number') {
      // Store feature file location for Cucumber scenarios
      rawTest.featureFile = rawTest.argument.uri
      rawTest.featureLine = rawTest.argument.line
      console.log('[Reporter] Captured Cucumber feature location:', {
        featureFile: rawTest.featureFile,
        featureLine: rawTest.featureLine
      })
    } else {
      console.log('[Reporter] No Cucumber argument data found')
    }

    // Enrich testStats with callSource info FIRST
    mapTestToSource(testStats, this.#currentSpecFile)
    if ((testStats as any).file && (testStats as any).line !== null) {
      ;(testStats as any).callSource =
        `${(testStats as any).file}:${(testStats as any).line}`
    }

    // Override with stable UID AFTER all metadata is enriched
    const stableUid = generateStableUid(testStats)
    ;(testStats as any).uid = stableUid
    console.log('[Reporter] Generated stable test UID:', stableUid)

    this.#sendUpstream()
  }

  onTestEnd(testStats: TestStats): void {
    super.onTestEnd(testStats)
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
        const actualUid = (suite as any).uid
        payload.push({ [actualUid]: suite })
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
