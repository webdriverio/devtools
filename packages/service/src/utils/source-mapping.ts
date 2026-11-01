import fs from 'fs'

import {
  TEST_FN_NAMES,
  SUITE_FN_NAMES,
  FEATURE_FILE_RE,
  FEATURE_OR_SCENARIO_LINE_RE
} from '../constants.js'
import { findStepDefinitionLocation } from './step-defs.js'
import {
  findTestLocations,
  getCurrentTestLocation,
  type Loc
} from './ast-locations.js'

export { findTestLocations, getCurrentTestLocation }

// ── Spec-file pointer + AST cache ───────────────────────────────────────────
let CURRENT_SPEC_FILE: string | undefined
export function setCurrentSpecFile(file?: string) {
  CURRENT_SPEC_FILE = file
}

const _astCache = new Map<string, Loc[]>()

// ── Text fallback helpers ───────────────────────────────────────────────────
function normalizeFullTitle(full?: string): string {
  return String(full || '')
    .replace(/^\d+:\s*/, '') // drop worker prefix like "0: "
    .replace(/\s+/g, ' ')
    .trim()
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function offsetToLineCol(
  src: string,
  offset: number
): { line: number; column: number } {
  let line = 1
  let col = 1
  for (let i = 0; i < offset && i < src.length; i++) {
    if (src.charCodeAt(i) === 10) {
      line++
      col = 1
    } else {
      col++
    }
  }
  return { line, column: col }
}

/** Textual fallback for the AST scan: find it/test/specify("<title>", ...). */
function findTestLocationByText(
  file: string,
  title: string
): { file: string; line: number; column: number } | undefined {
  try {
    const src = fs.readFileSync(file, 'utf-8')
    const q = `(['"\`])${escapeRegExp(title)}\\1`
    const call = String.raw`\b(?:${(TEST_FN_NAMES as readonly string[]).join('|')})\s*\(\s*${q}`
    const re = new RegExp(call)
    const m = re.exec(src)
    if (m && typeof m.index === 'number') {
      const { line, column } = offsetToLineCol(src, m.index)
      return { file, line, column }
    }
  } catch {
    /* unreadable file */
  }
  return undefined
}

function findSuiteLocationByText(
  file: string,
  title: string
): { file: string; line: number; column: number } | undefined {
  try {
    const src = fs.readFileSync(file, 'utf-8')
    const q = `(['"\`])${escapeRegExp(title)}\\1`
    const call = String.raw`\b(?:${(SUITE_FN_NAMES as readonly string[]).join('|')})\s*\(\s*${q}`
    const re = new RegExp(call)
    const m = re.exec(src)
    if (m && typeof m.index === 'number') {
      const { line, column } = offsetToLineCol(src, m.index)
      return { file, line, column }
    }
  } catch {
    /* unreadable file */
  }
  return undefined
}

// ── Stats enrichers ─────────────────────────────────────────────────────────
/**
 * Subset of stats fields {@link mapTestToSource}/{@link mapSuiteToSource}
 * read. The wdio reporter's TestStats/SuiteStats classes carry many more
 * fields (hooks, retries, etc.) that vary by reporter version, so the
 * function parameters stay `unknown` and we narrow internally with one cast
 * per call instead of per-field `as any` sprinkled through the body.
 */
interface StatsHintShape {
  title?: string
  fullTitle?: string
  file?: string
  specFile?: string
  specs?: string[]
}

const asHint = (stats: unknown): StatsHintShape =>
  (stats ?? {}) as StatsHintShape

/** Pull the most-relevant hint path from a stats fragment. Falls through:
 *  specs[0] → file → specFile → caller hint → tracked current spec file. */
function hintFromStats(
  stats: StatsHintShape,
  hintFile: string | undefined
): string | undefined {
  if (Array.isArray(stats.specs) && stats.specs[0]) {
    return stats.specs[0]
  }
  return stats.file || stats.specFile || hintFile || CURRENT_SPEC_FILE
}

/**
 * Enrich test stats with `file`/`line`/`column`:
 *  - Cucumber: prefer step-definition file/line
 *  - Mocha/Jasmine: AST with suite path; fallback to runtime stack
 */
function resolveTestFromAst(
  file: string,
  title: string,
  fullTitle: string
): { file: string; line?: number; column?: number } | undefined {
  if (!_astCache.has(file)) {
    try {
      _astCache.set(file, findTestLocations(file))
    } catch {
      /* parse errors */
    }
  }
  const locs = _astCache.get(file)
  if (!locs?.length) {
    return undefined
  }
  const match =
    locs.find(
      (l) =>
        l.type === 'test' &&
        l.name === title &&
        fullTitle.includes(l.titlePath.join(' '))
    ) || locs.find((l) => l.type === 'test' && l.name === title)
  if (!match) {
    return undefined
  }
  return { file, line: match.line, column: match.column }
}

export function mapTestToSource(testStats: unknown, hintFile?: string): void {
  const t = asHint(testStats)
  const title = String(t.title ?? '').trim()
  const fullTitle = normalizeFullTitle(t.fullTitle)

  // Cucumber-like step: resolve step-definition location
  if (/^(Given|When|Then|And|But)\b/i.test(title)) {
    const hint = hintFromStats(t, hintFile)
    const stepLoc = findStepDefinitionLocation(
      title,
      hint && FEATURE_FILE_RE.test(hint) ? hint : undefined
    )
    if (stepLoc) {
      Object.assign(testStats as object, stepLoc)
      return
    }
  }

  // Mocha/Jasmine static mapping via AST. The .file-first fallback ORDER
  // here matches the previous behavior — .file beats .specs[0].
  const file =
    t.file ||
    (Array.isArray(t.specs) ? t.specs[0] : undefined) ||
    t.specFile ||
    hintFile ||
    CURRENT_SPEC_FILE

  if (file && !FEATURE_FILE_RE.test(file)) {
    const astLoc = resolveTestFromAst(file, title, fullTitle)
    if (astLoc) {
      Object.assign(testStats as object, astLoc)
      return
    }
    const textLoc = findTestLocationByText(file, title)
    if (textLoc) {
      Object.assign(testStats as object, textLoc)
      return
    }
  }

  const runtimeLoc = getCurrentTestLocation()
  if (runtimeLoc) {
    Object.assign(testStats as object, runtimeLoc)
  }
}

/**
 * Enrich a suite with file/line:
 *  - Mocha/Jasmine: map describe/context by title path using AST
 *  - Cucumber: find Feature/Scenario line in .feature file
 */
function mapFeatureSuiteFromFile(
  file: string,
  title: string
): { file: string; line: number; column: number } | undefined {
  try {
    const src = fs.readFileSync(file, 'utf-8').split(/\r?\n/)
    const norm = (s: string) => s.trim().replace(/\s+/g, ' ')
    const want = norm(title)
    for (let i = 0; i < src.length; i++) {
      const m = src[i].match(FEATURE_OR_SCENARIO_LINE_RE)
      if (m && norm(m[2]) === want) {
        return { file, line: i + 1, column: 1 }
      }
    }
  } catch {
    /* unreadable file */
  }
  return undefined
}

function resolveSuiteFromAst(
  file: string,
  title: string,
  suitePath: string[]
): { file: string; line?: number; column?: number } | undefined {
  try {
    if (!_astCache.has(file)) {
      _astCache.set(file, findTestLocations(file))
    }
    const locs = _astCache.get(file)
    if (!locs?.length) {
      return undefined
    }
    const match =
      locs.find(
        (l) =>
          l.type === 'suite' &&
          Array.isArray(l.titlePath) &&
          l.titlePath.length === suitePath.length &&
          l.titlePath.every((t: string, i: number) => t === suitePath[i])
      ) || locs.find((l) => l.type === 'suite' && l.titlePath.at(-1) === title)
    if (match?.line) {
      return { file, line: match.line, column: match.column }
    }
  } catch {
    /* ignore */
  }
  return undefined
}

export function mapSuiteToSource(
  suiteStats: unknown,
  hintFile?: string,
  suitePath: string[] = []
): void {
  const s = asHint(suiteStats)
  const title = String(s.title ?? '').trim()
  const file = s.file || hintFile || CURRENT_SPEC_FILE
  if (!title || !file) {
    return
  }
  if (FEATURE_FILE_RE.test(file)) {
    const featureLoc = mapFeatureSuiteFromFile(file, title)
    if (featureLoc) {
      Object.assign(suiteStats as object, featureLoc)
    }
    return
  }
  const astLoc = resolveSuiteFromAst(file, title, suitePath)
  if (astLoc) {
    Object.assign(suiteStats as object, astLoc)
    return
  }

  // Fallback: text search
  const textLoc = findSuiteLocationByText(file, title)
  if (textLoc) {
    Object.assign(suiteStats as object, textLoc)
  }
}
