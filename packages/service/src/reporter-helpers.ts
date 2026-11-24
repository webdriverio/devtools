import { existsSync, readFileSync } from 'node:fs'
import { TestStats, type HookStats, type SuiteStats } from '@wdio/reporter'
import { deterministicUid } from '@wdio/devtools-core'
import { CUCUMBER_HOOK_LABEL } from './constants.js'
import type { ExampleRow, FeatureScenario } from './types.js'

export function isCucumberSuite(
  suite: SuiteStats | undefined
): suite is SuiteStats {
  const type = (suite as { type?: string } | undefined)?.type
  return type === 'feature' || type === 'scenario'
}

/** 1-based position among the owner's hooks of the same kind, stable across attempts and processes; undefined when the owner does not hold it. */
function hookPosition(hook: HookStats, owner: SuiteStats): number | undefined {
  const index = owner.hooks
    .filter((h) => h.hookKind === hook.hookKind)
    .indexOf(hook)
  return index === -1 ? undefined : index + 1
}

function hookRowTitle(hook: HookStats, position: number | undefined): string {
  const label = (hook.hookKind && CUCUMBER_HOOK_LABEL[hook.hookKind]) || 'Hook'
  const name = hook.title?.trim()
  const title = !name
    ? label
    : name.startsWith(label)
      ? name
      : `${label} ${name}`
  return position && position > 1 ? `${title} #${position}` : title
}

// The dashboard renders tests and suites, never hooks, so a failed hook becomes a failed test.
export function failedHookRow(
  hook: HookStats,
  owner: SuiteStats,
  ownerFrameworkUid: string,
  error: Error
): TestStats {
  const position = hookPosition(hook, owner)
  const title = hookRowTitle(hook, position)
  // Without a position the framework's hook id tells two hooks apart, though not across processes.
  const discriminator = position ? String(position) : `id:${hook.uid}`
  const row = new TestStats({
    type: 'test:fail',
    uid: deterministicUid(
      owner.uid,
      'hook',
      hook.hookKind ?? '',
      discriminator
    ),
    title,
    fullTitle: title,
    parent: ownerFrameworkUid,
    pending: false,
    file: owner.file,
    cid: hook.cid,
    specs: []
  })
  row.start = hook.start
  row.fail([error], hook.end ?? new Date())
  row.retries = 0
  row.hook = true
  return row
}

// Without an `order` on every child the app lists tests first; children already numbered keep theirs.
export function orderLast(suite: SuiteStats, row: TestStats): void {
  let next = 0
  for (const child of [
    ...suite.tests.filter((t) => t !== row),
    ...suite.suites
  ]) {
    child.order ??= next
    next = Math.max(next, child.order + 1)
  }
  row.order = next
}

/** A test's identity across its attempts: its parallel context when it has one, then file and fullTitle. */
export function attemptKey(testStats: TestStats): string {
  const title = testStats.fullTitle || testStats.title
  return `${testStats.contextId ?? ''}::${testStats.file ?? ''}::${title}`
}

export function descendants(suite: SuiteStats | undefined): SuiteStats[] {
  return (suite?.suites ?? []).flatMap((child) => [
    child,
    ...descendants(child)
  ])
}

const OUTLINE_KEYWORDS = ['Scenario Outline:', 'Scenario Template:']
const SCENARIO_KEYWORDS = ['Scenario:', 'Example:']
const EXAMPLES_KEYWORDS = ['Examples:', 'Scenarios:']

function keywordName(line: string, keywords: string[]): string | undefined {
  const keyword = keywords.find((k) => line.startsWith(k))
  return keyword === undefined ? undefined : line.slice(keyword.length).trim()
}

function unescapeCellChar(next: string): string {
  if (next === 'n') {
    return '\n'
  }
  return next === '|' || next === '\\' ? next : `\\${next}`
}

// Gherkin escapes `\|`, `\\` and `\n` inside a cell; any other backslash stays.
function tableCells(row: string): string[] {
  const cells: string[] = []
  let cell = ''
  for (let i = 1; i < row.length; i++) {
    const char = row[i]
    if (char === '|') {
      cells.push(cell.trim())
      cell = ''
    } else if (char === '\\' && i + 1 < row.length) {
      cell += unescapeCellChar(row[++i])
    } else {
      cell += char
    }
  }
  return cells
}

// Cucumber names an example by putting its row's values into the outline's `<column>` placeholders.
function exampleName(template: string, header: string[], cells: string[]) {
  return header.reduce(
    (name, column, i) => name.split(`<${column}>`).join(cells[i] ?? ''),
    template
  )
}

function findExamplesSectionStart(lines: string[], fromIndex: number): number {
  for (let i = fromIndex; i < lines.length; i++) {
    if (keywordName(lines[i].trim(), EXAMPLES_KEYWORDS) !== undefined) {
      return i
    }
  }
  return -1
}

// Every Examples table of the outline, numbered as Cucumber compiles them.
function collectExampleRows(
  lines: string[],
  examplesStartIndex: number,
  template: string
): ExampleRow[] {
  const rows: ExampleRow[] = []
  let header: string[] | undefined
  for (let i = examplesStartIndex + 1; i < lines.length; i++) {
    const line = lines[i].trim()
    if (keywordName(line, EXAMPLES_KEYWORDS) !== undefined) {
      header = undefined
    } else if (line.startsWith('Scenario') || line.startsWith('Feature:')) {
      break
    } else if (line.startsWith('|')) {
      const cells = tableCells(line)
      if (header) {
        rows.push({ line: i + 1, name: exampleName(template, header, cells) })
      } else {
        header = cells
      }
    }
  }
  return rows
}

function outlineExamples(
  lines: string[],
  scenarioIndex: number,
  template: string
): ExampleRow[] {
  const start = findExamplesSectionStart(lines, scenarioIndex)
  return start === -1 ? [] : collectExampleRows(lines, start, template)
}

// Exact, never `includes`: a title contained in an earlier scenario's title would find that scenario.
function findScenario(
  lines: string[],
  title: string
): FeatureScenario | undefined {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    const outline = keywordName(line, OUTLINE_KEYWORDS)
    if (outline !== undefined) {
      const examples = outlineExamples(lines, i, outline)
      if (outline === title || examples.some((e) => e.name === title)) {
        return { line: i + 1, examples }
      }
    } else if (keywordName(line, SCENARIO_KEYWORDS) === title) {
      return { line: i + 1, examples: outlineExamples(lines, i, title) }
    }
  }
  return undefined
}

/** The scenario titled `title` in a feature file, or null when neither is found. */
export function readFeatureScenario(
  filePath: string,
  title: string
): FeatureScenario | null {
  try {
    if (!existsSync(filePath)) {
      return null
    }
    const lines = readFileSync(filePath, 'utf-8').split('\n')
    return findScenario(lines, title) ?? null
  } catch (error) {
    console.error('[Reporter] Failed to parse feature file:', error)
    return null
  }
}

/** An example's row line: the one row Cucumber gives its title, else its position among its outline's pickles. */
export function exampleLine(
  scenario: FeatureScenario,
  title: string,
  positionInOutline: number
): number | undefined {
  const named = scenario.examples.filter((e) => e.name === title)
  if (named.length === 1) {
    return named[0].line
  }
  return scenario.examples[positionInOutline]?.line
}
