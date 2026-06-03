import * as fs from 'node:fs'
import * as path from 'node:path'
import { parse as parseStackTrace } from 'stacktrace-parser'
import {
  findTestDefinitions,
  generateStableUid as generateStableUidByFileName,
  isUserCodeFrame,
  normalizeFilePath
} from '@wdio/devtools-core'
import { TEST_FILE_PATTERN, CONFIG_FILENAMES } from '../constants.js'
import type {
  NightwatchTestCase,
  TestFileMetadata,
  StepLocation,
  TestStats
} from '../types.js'

// These three are pure re-exports — adapters use the core implementations
// directly, no wrapper logic. Single-line re-exports keep the indirection
// visible without introducing dummy variables.
export {
  deterministicUid,
  getCallSourceFromStack,
  resetSignatureCounters
} from '@wdio/devtools-core'

export function determineTestState(
  testcase: NightwatchTestCase
): 'passed' | 'failed' | 'skipped' {
  if (testcase.passed === 0 && testcase.failed === 0) {
    return 'skipped'
  }
  return testcase.passed > 0 && testcase.failed === 0 ? 'passed' : 'failed'
}

export function getTestIcon(state: TestStats['state']): string {
  return state === 'passed' ? '✅' : state === 'skipped' ? '⏭' : '❌'
}

export function incrementCounters(
  counters: { passCount: number; failCount: number; skipCount: number },
  state: TestStats['state']
): void {
  if (state === 'passed') {
    counters.passCount++
  } else if (state === 'skipped') {
    counters.skipCount++
  } else {
    counters.failCount++
  }
}

export function buildPluginMetadataOptions(input: {
  isCucumberRunner: boolean
  configPath: string | undefined
}) {
  return {
    framework: input.isCucumberRunner ? 'nightwatch-cucumber' : 'nightwatch',
    configFile: input.configPath,
    baseDir: process.cwd(),
    runCapabilities: {
      canRunSuites: true,
      canRunTests: !input.isCucumberRunner,
      canRunAll: false
    }
  }
}

/**
 * Generate stable UID for test/suite.
 * Accepts either (item: SuiteStats | TestStats) or (file: string, name: string).
 * Hashing is delegated to @wdio/devtools-core; this wrapper preserves the
 * dual-signature convenience used by the Nightwatch suite/test managers.
 */
type StableUidSource = { file?: string; fullTitle?: string; title?: string }
export function generateStableUid(
  itemOrFile: string | StableUidSource,
  name?: string
): string {
  let file: string, testName: string
  if (
    typeof itemOrFile === 'object' &&
    itemOrFile !== null &&
    name === undefined
  ) {
    file = itemOrFile.file || ''
    testName = String(itemOrFile.fullTitle || itemOrFile.title)
  } else {
    file = (itemOrFile as string) || ''
    testName = String(name || '')
  }
  return generateStableUidByFileName(file, testName)
}

/**
 * Find test file from stack trace.
 * Parses call stack to find the first frame that looks like a test file.
 */
export function findTestFileFromStack(): string | undefined {
  const stack = new Error().stack
  if (!stack) {
    return undefined
  }

  // Prefer a frame whose filename matches *.test.ts / *.spec.ts (strong
  // signal). Fall back to the first plain user-code frame so arbitrary
  // project layouts (e.g. Cucumber step files under `src/steps/`) still
  // surface their owning file instead of going undetected.
  const frames = parseStackTrace(stack)
  const preferred = frames.find(
    (f) => isUserCodeFrame(f) && TEST_FILE_PATTERN.test(f.file)
  )
  const frame = preferred ?? frames.find(isUserCodeFrame)
  if (!frame?.file) {
    return undefined
  }

  const filePath = normalizeFilePath(frame.file)
  return fs.existsSync(filePath) ? filePath : undefined
}

/**
 * Extract suite and test names — and their line numbers — from a test file.
 * Returns a TestFileMetadata object used to build `callSource` strings for
 * the TestLens eye-icon navigation.
 */
export function extractTestMetadata(filePath: string): TestFileMetadata {
  const defs = findTestDefinitions(filePath, {
    includeNightwatchObjectStyle: true
  })
  const firstSuite = defs.find((d) => d.kind === 'suite')
  const tests = defs.filter((d) => d.kind === 'test')
  return {
    suiteTitle: firstSuite?.title ?? null,
    suiteLine: firstSuite?.line ?? null,
    testNames: tests.map((t) => t.title),
    testLines: tests.map((t) => t.line)
  }
}

/**
 * Find test file by searching the workspace for a matching filename.
 * Used when the stack trace doesn't have the file yet (e.g. in beforeEach).
 */
export function findTestFileByName(
  filename: string,
  workspaceRoot?: string
): string | undefined {
  if (!filename || !workspaceRoot) {
    return undefined
  }

  const baseFilename = filename.replace(/\.[cm]?[jt]sx?$/, '')

  function searchDir(dir: string, depth = 0): string | undefined {
    if (depth > 5) {
      return undefined
    }
    try {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, entry.name)
        if (entry.isDirectory()) {
          const found = searchDir(fullPath, depth + 1)
          if (found) {
            return found
          }
        } else if (
          TEST_FILE_PATTERN.test(entry.name) &&
          entry.name.replace(TEST_FILE_PATTERN, '') === baseFilename
        ) {
          return fullPath
        }
      }
    } catch {
      // Permission denied or other error — skip
    }
    return undefined
  }

  return searchDir(workspaceRoot)
}

// ---------------------------------------------------------------------------
// Console / log helpers (used by SessionCapturer)
// ---------------------------------------------------------------------------

// Console helpers come from @wdio/devtools-core. `stripAnsiCodes` is the
// local name kept for backwards compatibility with existing import sites.
export {
  stripAnsi as stripAnsiCodes,
  detectLogLevel,
  createConsoleLogEntry
} from '@wdio/devtools-core'

export { chromeLogLevelToLogLevel } from '@wdio/devtools-core'

/** Derive a human-readable request type from URL and MIME type. */
export { getRequestType } from '@wdio/devtools-core'

// ---------------------------------------------------------------------------
// Cucumber helpers
// ---------------------------------------------------------------------------

/**
 * Parse a feature file for a given scenario in a single pass, returning:
 *  - `featureLine`  — 1-based line of the `Feature:` declaration
 *  - `scenarioLine` — 1-based line of the matching `Scenario:` block
 *  - `stepLines`    — 1-based line numbers for each step (for TestLens navigation)
 *  - `stepKeywords` — BDD keyword (Given/When/Then/And/But) for each step (for labels)
 */
function collectStepsAfterScenario(
  lines: string[],
  scenarioIndex: number,
  stepCount: number
): { stepLines: number[]; stepKeywords: string[] } {
  const stepRe = /^\s*(Given|When|Then|And|But)\s+/i
  const stepLines: number[] = []
  const stepKeywords: string[] = []
  for (
    let j = scenarioIndex + 1;
    j < lines.length && stepLines.length < stepCount;
    j++
  ) {
    if (/^\s*(?:Scenario:|Feature:)/i.test(lines[j])) {
      break
    }
    const m = stepRe.exec(lines[j])
    if (m) {
      stepLines.push(j + 1)
      stepKeywords.push(m[1])
    }
  }
  return { stepLines, stepKeywords }
}

export function parseCucumberScenario(
  featureContent: string,
  scenarioName: string,
  stepTexts: string[]
): {
  featureLine: number
  scenarioLine: number
  stepLines: number[]
  stepKeywords: string[]
} {
  const stepCount = stepTexts.length
  if (!featureContent) {
    return {
      featureLine: 1,
      scenarioLine: 1,
      stepLines: [],
      stepKeywords: Array<string>(stepCount).fill('')
    }
  }
  const lines = featureContent.split('\n')
  let featureLine = 1
  let scenarioLine = 1
  let stepLines: number[] = []
  let stepKeywords: string[] = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const lineNum = i + 1
    if (featureLine === 1 && /^\s*Feature:/i.test(line)) {
      featureLine = lineNum
      continue
    }
    if (/^\s*Scenario:/i.test(line) && line.includes(scenarioName)) {
      scenarioLine = lineNum
      const collected = collectStepsAfterScenario(lines, i, stepCount)
      stepLines = collected.stepLines
      stepKeywords = collected.stepKeywords
      break
    }
  }
  while (stepKeywords.length < stepCount) {
    stepKeywords.push('')
  }
  return { featureLine, scenarioLine, stepLines, stepKeywords }
}

/** Maps Cucumber parameter type placeholder names to their regex equivalents. */
const CUCUMBER_TYPE_PATTERNS: Record<string, string> = {
  int: '-?\\d+',
  float: '-?\\d+(?:\\.\\d+)?',
  string: '(?:"[^"]*"|\'[^\']*\')',
  word: '\\S+'
}

/**
 * Convert a Cucumber expression pattern to a regular expression and test it
 * against the given step text. Handles {int}, {float}, {string}, {word}, and
 * arbitrary {type} placeholders.
 */
function matchesCucumberExpression(pattern: string, text: string): boolean {
  if (pattern === text) {
    return true
  }
  const regexSource = pattern
    .split(/(\{[^}]*\})/)
    .map((part, idx) => {
      if (idx % 2 === 1) {
        const type = part.slice(1, -1)
        return CUCUMBER_TYPE_PATTERNS[type] ?? '[\\s\\S]+'
      }
      return part.replace(/[|\\{}()[\]^$+*?.]/g, '\\$&')
    })
    .join('')
  try {
    return new RegExp(`^${regexSource}$`).test(text)
  } catch {
    return false
  }
}

/**
 * Find the file and 1-based line number of the step definition that matches
 * the given step text. Searches the provided step definition files in order.
 * Handles both string/Cucumber-expression patterns and regex literals.
 */
export function findStepDefinitionLine(
  stepDefFiles: Array<{ filePath: string; content: string }>,
  stepText: string
): StepLocation | null {
  const stepDefRe = /(?:Given|When|Then|And|But)\s*\(/i

  for (const { filePath, content } of stepDefFiles) {
    const lines = content.split('\n')
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      if (!stepDefRe.test(line)) {
        continue
      }

      // String / Cucumber-expression: Given('pattern', ...) or Given("pattern", ...)
      const literalMatch = line.match(
        /(?:Given|When|Then|And|But)\s*\(\s*(['"`])(.*?)\1/i
      )
      if (literalMatch) {
        if (matchesCucumberExpression(literalMatch[2], stepText)) {
          return { filePath, line: i + 1 }
        }
        continue
      }

      // Regex literal: Given(/pattern/flags, ...)
      const regexMatch = line.match(
        /(?:Given|When|Then|And|But)\s*\(\s*\/(.+?)\/([gimy]*)/i
      )
      if (regexMatch) {
        try {
          if (new RegExp(regexMatch[1], regexMatch[2]).test(stepText)) {
            return { filePath, line: i + 1 }
          }
        } catch {
          // invalid regex — skip
        }
      }
    }
  }
  return null
}

export { isPortInUse, findFreePort } from '@wdio/devtools-core'

export function resolveNightwatchConfig(): string | undefined {
  // Prefer the config explicitly passed via -c / --config to avoid picking up
  // an unrelated config file that happens to sit higher in the directory tree.
  const configFlagIdx = process.argv.findIndex(
    (arg) => arg === '--config' || arg === '-c'
  )
  if (configFlagIdx !== -1 && process.argv[configFlagIdx + 1]) {
    const argvConfig = process.argv[configFlagIdx + 1]
    const resolved = path.isAbsolute(argvConfig)
      ? argvConfig
      : path.resolve(process.cwd(), argvConfig)
    if (fs.existsSync(resolved)) {
      return resolved
    }
  }

  // Fallback: walk up the directory tree
  let dir = process.cwd()
  const root = path.parse(dir).root
  while (dir && dir !== root) {
    for (const file of CONFIG_FILENAMES) {
      const candidate = path.join(dir, file)
      if (fs.existsSync(candidate)) {
        return candidate
      }
    }
    const parent = path.dirname(dir)
    if (parent === dir) {
      break
    }
    dir = parent
  }
  return undefined
}
