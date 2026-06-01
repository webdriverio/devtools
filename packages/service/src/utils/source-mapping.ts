import fs from 'fs'
import { createRequire } from 'node:module'
import { parse } from '@babel/parser'
import type { Node as BabelNode, TraverseOptions } from '@babel/traverse'
import { parse as parseStackTrace } from 'stack-trace'

import {
  PARSE_PLUGINS,
  TEST_FN_NAMES,
  SUITE_FN_NAMES,
  STEP_FILE_RE,
  STEP_DIR_RE,
  SPEC_FILE_RE,
  FEATURE_FILE_RE,
  FEATURE_OR_SCENARIO_LINE_RE
} from '../constants.js'
import { findStepDefinitionLocation } from './step-defs.js'

const require = createRequire(import.meta.url)
const traverse = (
  require('@babel/traverse') as {
    default: (parent: BabelNode, opts?: TraverseOptions) => void
  }
).default

// ── Spec-file pointer + AST cache ───────────────────────────────────────────
let CURRENT_SPEC_FILE: string | undefined
export function setCurrentSpecFile(file?: string) {
  CURRENT_SPEC_FILE = file
}

const _astCache = new Map<string, Loc[]>()

interface Loc {
  type: 'test' | 'suite'
  name: string
  titlePath: string[]
  line?: number
  column?: number
}

// ── AST extraction ──────────────────────────────────────────────────────────
function rootCalleeName(callee: any): string | undefined {
  if (!callee) {
    return
  }
  if (callee.type === 'Identifier') {
    return callee.name
  }
  if (callee.type === 'MemberExpression') {
    const obj: any = callee.object
    return obj && obj.type === 'Identifier' ? obj.name : undefined
  }
  return
}

/** Parse a JS/TS test/spec file and collect suite/test calls (Mocha/Jasmine)
 *  with full title paths. */
export function findTestLocations(filePath: string): Loc[] {
  if (!fs.existsSync(filePath)) {
    return []
  }

  const src = fs.readFileSync(filePath, 'utf-8')
  const ast = parse(src, {
    sourceType: 'module',
    plugins: PARSE_PLUGINS as any,
    errorRecovery: true,
    allowReturnOutsideFunction: true
  })

  const out: Loc[] = []
  const suiteStack: string[] = []

  const isSuite = (n?: string) =>
    (!!n && (SUITE_FN_NAMES as readonly string[]).includes(n)) ||
    n === 'Feature'
  const isTest = (n?: string) =>
    !!n && (TEST_FN_NAMES as readonly string[]).includes(n)

  const staticTitle = (node: any): string | undefined => {
    if (!node) {
      return
    }
    if (node.type === 'StringLiteral') {
      return node.value
    }
    if (node.type === 'TemplateLiteral' && node.expressions.length === 0) {
      return node.quasis.map((q: any) => q.value.cooked).join('')
    }
    return
  }

  traverse(ast, {
    enter(p) {
      if (!p.isCallExpression()) {
        return
      }
      const callee: any = p.node.callee
      const root = rootCalleeName(callee)
      if (!root) {
        return
      }

      if (isSuite(root)) {
        const ttl = staticTitle(p.node.arguments?.[0] as any)
        if (ttl) {
          out.push({
            type: 'suite',
            name: ttl,
            titlePath: [...suiteStack, ttl],
            line: p.node.loc?.start.line,
            column: p.node.loc?.start.column
          })
          suiteStack.push(ttl)
        }
      } else if (isTest(root)) {
        const ttl = staticTitle(p.node.arguments?.[0] as any)
        if (ttl) {
          out.push({
            type: 'test',
            name: ttl,
            titlePath: [...suiteStack, ttl],
            line: p.node.loc?.start.line,
            column: p.node.loc?.start.column
          })
        }
      }
    },
    exit(p) {
      if (!p.isCallExpression()) {
        return
      }
      const callee: any = p.node.callee
      const root = rootCalleeName(callee)
      if (!root || !isSuite(root)) {
        return
      }
      const ttl = ((): string | undefined => {
        const a0: any = p.node.arguments?.[0]
        if (a0?.type === 'StringLiteral') {
          return a0.value
        }
        if (a0?.type === 'TemplateLiteral' && a0.expressions.length === 0) {
          return a0.quasis.map((q: any) => q.value.cooked).join('')
        }
        return
      })()
      if (ttl && suiteStack[suiteStack.length - 1] === ttl) {
        suiteStack.pop()
      }
    }
  })

  return out
}

/** Capture a stack trace and pick a user frame. Prefers step-definition
 *  files, then specs, then `.feature` files. */
export function getCurrentTestLocation():
  | { file: string; line: number; column: number }
  | null {
  const frames = parseStackTrace(new Error())

  const pick = (predicate: (f: any) => boolean) => {
    const f = frames.find((fr) => {
      const fn = fr.getFileName()
      return !!fn && !fn.includes('node_modules') && predicate(fr)
    })
    return f
      ? {
          file: f.getFileName() as string,
          line: f.getLineNumber() as number,
          column: f.getColumnNumber() as number
        }
      : null
  }

  const step = pick((fr) => {
    const fn = fr.getFileName() as string
    return STEP_FILE_RE.test(fn) || STEP_DIR_RE.test(fn)
  })
  if (step) {
    return step
  }

  const spec = pick((fr) => SPEC_FILE_RE.test(fr.getFileName() as string))
  if (spec) {
    return spec
  }

  const feature = pick((fr) => FEATURE_FILE_RE.test(fr.getFileName() as string))
  if (feature) {
    return feature
  }

  return null
}

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
 * Enrich test stats with `file`/`line`/`column`:
 *  - Cucumber: prefer step-definition file/line
 *  - Mocha/Jasmine: AST with suite path; fallback to runtime stack
 */
export function mapTestToSource(testStats: any, hintFile?: string): void {
  const title = String(testStats?.title ?? '').trim()
  const fullTitle = normalizeFullTitle(testStats?.fullTitle)

  const hint =
    (Array.isArray((testStats as any).specs)
      ? (testStats as any).specs[0]
      : undefined) ||
    (testStats as any).file ||
    (testStats as any).specFile ||
    hintFile ||
    CURRENT_SPEC_FILE

  // Cucumber-like step: resolve step-definition location
  if (/^(Given|When|Then|And|But)\b/i.test(title)) {
    const stepLoc = findStepDefinitionLocation(
      title,
      FEATURE_FILE_RE.test(String(hint)) ? hint : undefined
    )
    if (stepLoc) {
      Object.assign(testStats, stepLoc)
      return
    }
  }

  // Mocha/Jasmine static mapping via AST
  const file =
    (testStats as any).file ||
    (Array.isArray((testStats as any).specs)
      ? (testStats as any).specs[0]
      : undefined) ||
    (testStats as any).specFile ||
    hintFile ||
    CURRENT_SPEC_FILE

  if (file && !FEATURE_FILE_RE.test(file)) {
    if (!_astCache.has(file)) {
      try {
        _astCache.set(file, findTestLocations(file))
      } catch {
        /* parse errors */
      }
    }
    const locs = _astCache.get(file)
    if (locs?.length) {
      const match =
        locs.find(
          (l) =>
            l.type === 'test' &&
            l.name === title &&
            fullTitle.includes(l.titlePath.join(' '))
        ) || locs.find((l) => l.type === 'test' && l.name === title)

      if (match) {
        Object.assign(testStats, {
          file,
          line: match.line,
          column: match.column
        })
        return
      }
    }

    const textLoc = findTestLocationByText(file, title)
    if (textLoc) {
      Object.assign(testStats, textLoc)
      return
    }
  }

  // Runtime stack fallback
  const runtimeLoc = getCurrentTestLocation()
  if (runtimeLoc) {
    Object.assign(testStats, runtimeLoc)
  }
}

/**
 * Enrich a suite with file/line:
 *  - Mocha/Jasmine: map describe/context by title path using AST
 *  - Cucumber: find Feature/Scenario line in .feature file
 */
export function mapSuiteToSource(
  suiteStats: any,
  hintFile?: string,
  suitePath: string[] = []
): void {
  const title = String(suiteStats?.title ?? '').trim()
  const file = (suiteStats as any).file || hintFile || CURRENT_SPEC_FILE
  if (!title || !file) {
    return
  }

  // Cucumber: feature/scenario line
  if (FEATURE_FILE_RE.test(file)) {
    try {
      const src = fs.readFileSync(file, 'utf-8').split(/\r?\n/)
      const norm = (s: string) => s.trim().replace(/\s+/g, ' ')
      const want = norm(title)
      for (let i = 0; i < src.length; i++) {
        const m = src[i].match(FEATURE_OR_SCENARIO_LINE_RE)
        if (m && norm(m[2]) === want) {
          Object.assign(suiteStats, { file, line: i + 1, column: 1 })
          return
        }
      }
    } catch {
      /* unreadable file */
    }
    return
  }

  // Mocha/Jasmine: AST first
  try {
    if (!_astCache.has(file)) {
      _astCache.set(file, findTestLocations(file))
    }
    const locs = _astCache.get(file)
    if (locs?.length) {
      const match =
        locs.find(
          (l) =>
            l.type === 'suite' &&
            Array.isArray(l.titlePath) &&
            l.titlePath.length === suitePath.length &&
            l.titlePath.every((t: string, i: number) => t === suitePath[i])
        ) ||
        locs.find((l) => l.type === 'suite' && l.titlePath.at(-1) === title)

      if (match?.line) {
        Object.assign(suiteStats, {
          file,
          line: match.line,
          column: match.column
        })
        return
      }
    }
  } catch {
    /* ignore */
  }

  // Fallback: text search
  const textLoc = findSuiteLocationByText(file, title)
  if (textLoc) {
    Object.assign(suiteStats, textLoc)
  }
}
