import fs from 'fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { parse } from '@babel/parser'
import * as babelTraverse from '@babel/traverse'
import type { NodePath } from '@babel/traverse'
import type { CallExpression } from '@babel/types'

import {
  PARSE_PLUGINS,
  TEST_FN_NAMES,
  SUITE_FN_NAMES,
  STEP_FN_NAMES,
  STEP_FILE_RE,
  STEP_DIR_RE,
  SPEC_FILE_RE,
  FEATURE_FILE_RE,
  FEATURE_OR_SCENARIO_LINE_RE,
  STEP_DEF_REGEX_LITERAL_RE,
  STEP_DEF_STRING_RE,
  SOURCE_FILE_EXT_RE,
  STEPS_DIR_CANDIDATES,
  STEPS_DIR_ASCENT_MAX,
  STEPS_GLOBAL_SEARCH_MAX_DEPTH
} from './constants.js'

const require = createRequire(import.meta.url)
const stackTrace = require('stack-trace') as typeof import('stack-trace')
const _astCache = new Map<string, any[]>()

let CE: { CucumberExpression: any, ParameterTypeRegistry: any } | undefined
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const ce = require('@cucumber/cucumber-expressions')
  CE = { CucumberExpression: ce.CucumberExpression, ParameterTypeRegistry: ce.ParameterTypeRegistry }
} catch { /* optional */ }

const traverse: (typeof import('@babel/traverse'))['default'] =
  (babelTraverse as any).default ?? (babelTraverse as any)

/**
 * Track current spec file (set by reporter)
 */
let CURRENT_SPEC_FILE: string | undefined
export function setCurrentSpecFile(file?: string) {
  CURRENT_SPEC_FILE = file
}

/**
 * Get the top-level browser object from an element/browser
 */
export function getBrowserObject (elem: WebdriverIO.Element | WebdriverIO.Browser): WebdriverIO.Browser {
  const elemObject = elem as WebdriverIO.Element
  return (elemObject as WebdriverIO.Element).parent
    ? getBrowserObject(elemObject.parent)
    : (elem as WebdriverIO.Browser)
}

/**
 * Get root callee name (handles Identifier and MemberExpression like it.only)
 */
function rootCalleeName(callee: any): string | undefined {
  if (!callee) return
  if (callee.type === 'Identifier') return callee.name
  if (callee.type === 'MemberExpression') {
    const obj: any = callee.object
    return obj && obj.type === 'Identifier' ? obj.name : undefined
  }
  return
}

/**
 * Parse a JS/TS test/spec file to collect suite/test calls (Mocha/Jasmine) with full title path
 */
export function findTestLocations(filePath: string) {
  if (!fs.existsSync(filePath)) return []

  const src = fs.readFileSync(filePath, 'utf-8')
  const ast = parse(src, {
    sourceType: 'module',
    plugins: PARSE_PLUGINS as any,
    errorRecovery: true,
    allowReturnOutsideFunction: true,
  })

  type Loc = {
    type: 'test' | 'suite'
    name: string
    titlePath: string[]
    line?: number
    column?: number
  }

  const out: Loc[] = []
  const suiteStack: string[] = []

  const isSuite = (n?: string) => !!n && (SUITE_FN_NAMES as readonly string[]).includes(n) || n === 'Feature'
  const isTest = (n?: string) => !!n && (TEST_FN_NAMES as readonly string[]).includes(n)

  const staticTitle = (node: any): string | undefined => {
    if (!node) return
    if (node.type === 'StringLiteral') return node.value
    if (node.type === 'TemplateLiteral' && node.expressions.length === 0) {
      return node.quasis.map((q: any) => q.value.cooked).join('')
    }
    return
  }

  traverse(ast, {
    enter(p) {
      if (!p.isCallExpression()) return
      const callee: any = p.node.callee
      const root = rootCalleeName(callee)
      if (!root) return

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
      if (!p.isCallExpression()) return
      const callee: any = p.node.callee
      const root = rootCalleeName(callee)
      if (!root || !isSuite(root)) return
      const ttl = ((): string | undefined => {
        const a0: any = p.node.arguments?.[0]
        if (a0?.type === 'StringLiteral') return a0.value
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

/**
 * Capture stack trace and try to find a user frame.
 * Prefer step-definition files, then spec/tests, then feature files.
 */
export function getCurrentTestLocation() {
  const frames = stackTrace.parse(new Error())

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
  if (step) return step

  const spec = pick((fr) => SPEC_FILE_RE.test(fr.getFileName() as string))
  if (spec) return spec

  const feature = pick((fr) => FEATURE_FILE_RE.test(fr.getFileName() as string))
  if (feature) return feature

  return null
}

/**
 * Step-definition discovery and matching (Cucumber)
 */
type StepDef = {
  kind: 'regex' | 'string' | 'expression'
  keyword?: string
  text?: string
  regex?: RegExp
  expr?: any
  file: string
  line: number
  column: number
}

// Look for step-definitions directory by ascending from a base directory
function _findStepsDir(startDir: string): string | undefined {
  let dir = startDir
  for (let i = 0; i < STEPS_DIR_ASCENT_MAX; i++) {
    for (const c of STEPS_DIR_CANDIDATES) {
      const p = path.join(dir, c)
      if (fs.existsSync(p) && fs.statSync(p).isDirectory()) return p
    }
    const up = path.dirname(dir)
    if (up === dir) break
    dir = up
  }
  return undefined
}

// Global fallback (find a features/*/(step-definitions|steps) directory under cwd)
let _globalStepsDir: string | undefined
function _findStepsDirGlobal(): string | undefined {
  if (_globalStepsDir && fs.existsSync(_globalStepsDir)) return _globalStepsDir

  const root = process.cwd()
  const queue: { dir: string; depth: number }[] = [{ dir: root, depth: 0 }]
  const maxDepth = STEPS_GLOBAL_SEARCH_MAX_DEPTH
  while (queue.length) {
    const { dir, depth } = queue.shift()!
    if (depth > maxDepth) continue

    // Look for a features folder here
    const featuresDir = path.join(dir, 'features')
    if (fs.existsSync(featuresDir) && fs.statSync(featuresDir).isDirectory()) {
      for (const c of STEPS_DIR_CANDIDATES) {
        const p = path.join(featuresDir, c)
        if (fs.existsSync(p) && fs.statSync(p).isDirectory()) {
          _globalStepsDir = p
          return p
        }
      }
    }

    // BFS into subdirs
    for (const entry of fs.readdirSync(dir)) {
      if (entry.startsWith('.')) continue
      const full = path.join(dir, entry)
      let st: fs.Stats
      try { st = fs.statSync(full) } catch { continue }
      if (st.isDirectory() && !full.includes('node_modules')) {
        queue.push({ dir: full, depth: depth + 1 })
      }
    }
  }
  return undefined
}

// Recursively list all source files in a directory
function _listFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of fs.readdirSync(dir)) {
    const full = path.join(dir, entry)
    const st = fs.statSync(full)
    if (st.isDirectory()) out.push(..._listFiles(full))
    else if (SOURCE_FILE_EXT_RE.test(entry)) out.push(full)
  }
  return out
}

// Text fallback: scan a file for step definitions on a single line
function _collectStepDefsFromText(file: string): StepDef[] {
  const out: StepDef[] = []
  const src = fs.readFileSync(file, 'utf-8')
  const lines = src.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    // Regex step: Given(/^...$/i, ...)
    const mRe = line.match(STEP_DEF_REGEX_LITERAL_RE)
    if (mRe) {
      const lit = mRe[2] // like /pattern/flags
      const lastSlash = lit.lastIndexOf('/')
      const pattern = lit.slice(1, lastSlash)
      const flags = lit.slice(lastSlash + 1)
      try {
        out.push({
          kind: 'regex',
          regex: new RegExp(pattern, flags),
          file,
          line: i + 1,
          column: mRe.index ?? 0
        })
        continue
      } catch {
        // ignore malformed regex
      }
    }
    // String step: Given('I do X', ...)
    const mStr = line.match(STEP_DEF_STRING_RE)
    if (mStr) {
      const keyword = mStr[1]
      const text = mStr[3]
      out.push({
        kind: 'string',
        keyword,
        text,
        file,
        line: i + 1,
        column: mStr.index ?? 0
      })
    }
  }
  return out
}

const _stepsCache = new Map<string, StepDef[]>()
function _collectStepDefs(stepsDir: string): StepDef[] {
  const cached = _stepsCache.get(stepsDir)
  if (cached) return cached

  const files = _listFiles(stepsDir)
  const defs: StepDef[] = []

  for (const file of files) {
    let pushed = 0
    try {
      const src = fs.readFileSync(file, 'utf-8')
      const ast = parse(src, { sourceType: 'module', plugins: PARSE_PLUGINS as any, errorRecovery: true })

      traverse(ast, {
        CallExpression(p: NodePath<CallExpression>) {
          const callee: any = p.node.callee
          // Support Identifier (Given(...)) and MemberExpression (cucumber.Given(...))
          let name: string | undefined
          if (callee?.type === 'Identifier') {
            name = callee.name
          } else if (callee?.type === 'MemberExpression') {
            const prop = (callee as any).property
            if (prop?.type === 'Identifier') name = prop.name
          }
          if (!name || !(STEP_FN_NAMES as readonly string[]).includes(name)) return

          const arg = p.node.arguments?.[0] as any
          const loc = { file, line: p.node.loc?.start.line ?? 1, column: p.node.loc?.start.column ?? 0 }

          if (arg?.type === 'RegExpLiteral') {
            defs.push({ kind: 'regex', regex: new RegExp(arg.pattern, arg.flags ?? ''), ...loc })
            pushed++
          } else if (arg?.type === 'StringLiteral') {
            // If Cucumber Expressions is available and pattern contains {...}, treat as expression
            if (CE && arg.value.includes('{')) {
              const expr = new CE!.CucumberExpression(arg.value, new CE!.ParameterTypeRegistry())
              defs.push({ kind: 'expression', expr, ...loc })
            } else {
              defs.push({ kind: 'string', keyword: name, text: arg.value, ...loc })
            }
            pushed++
          }
        }
      })
    } catch {
      // ignore AST parse errors; fallback below
    }
    // If AST found nothing, fallback to text scan for this file
    if (pushed === 0) {
      const fromText = _collectStepDefsFromText(file)
      if (fromText.length) {
        defs.push(...fromText)
      }
    }
  }

  _stepsCache.set(stepsDir, defs)
  return defs
}

function findStepDefinitionLocation(stepTitle: string, hintPath?: string) {
  const baseDir = hintPath
    ? (path.extname(hintPath) ? path.dirname(hintPath) : hintPath)
    : undefined

  let stepsDir = baseDir ? _findStepsDir(baseDir) : undefined
  if (!stepsDir) stepsDir = _findStepsDirGlobal()
  if (!stepsDir) return

  const defs = _collectStepDefs(stepsDir)

  const title = String(stepTitle ?? '').trim()
  const titleNoKw = title.replace(/^(Given|When|Then|And|But)\s+/i, '').trim()

  // String match
  const s = defs.find(d =>
    d.kind === 'string' &&
    (titleNoKw.localeCompare(d.text!, 'en', { sensitivity: 'base' }) === 0 ||
     title.localeCompare(`${d.keyword} ${d.text}`, 'en', { sensitivity: 'base' }) === 0)
  )
  if (s) return { file: s.file, line: s.line, column: s.column }

  // Cucumber expression match
  const e = defs.find(d => d.kind === 'expression' && (() => {
    try { return !!d.expr!.match(titleNoKw) || !!d.expr!.match(title) } catch { return false }
  })())
  if (e) return { file: e.file, line: e.line, column: e.column }

  // Regex match
  const r = defs.find(d =>
    d.kind === 'regex' && (d.regex!.test(titleNoKw) || d.regex!.test(title))
  )
  if (r) return { file: r.file, line: r.line, column: r.column }

  return
}

/**
 * Helpers for Mocha/Jasmine mapping
 */
function normalizeFullTitle(full?: string) {
  return String(full || '')
    .replace(/^\d+:\s*/, '') // drop worker prefix like "0: "
    .replace(/\s+/g, ' ')
    .trim()
}

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function offsetToLineCol(src: string, offset: number) {
  let line = 1, col = 1
  for (let i = 0; i < offset && i < src.length; i++) {
    if (src.charCodeAt(i) === 10) { line++; col = 1 } else { col++ }
  }
  return { line, column: col }
}

/**
 * Textual fallback: find the test by scanning for it/test/specify(...) with the exact title.
 * Works even if Babel AST couldn’t be built or callee is wrapped.
 */
function findTestLocationByText(file: string, title: string) {
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
  } catch {}
  return undefined
}

// Find describe/context/suite("<title>", ...) by text as a fallback
function findSuiteLocationByText(file: string, title: string) {
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
  } catch {}
  return undefined
}

/**
 * Enrich stats:
 * - Cucumber: prefer step-definition file/line
 * - Mocha/Jasmine: AST with suite path; fallback to runtime stack
 */
export function mapTestToSource(testStats: any, hintFile?: string) {
  const title = String(testStats?.title ?? '').trim()
  const fullTitle = normalizeFullTitle(testStats?.fullTitle)

  // Hint for locating related files
  const hint =
    (Array.isArray((testStats as any).specs) ? (testStats as any).specs[0] : undefined) ||
    (testStats as any).file ||
    (testStats as any).specFile ||
    hintFile ||
    CURRENT_SPEC_FILE

  // Cucumber-like step: resolve step-definition location
  if (/^(Given|When|Then|And|But)\b/i.test(title)) {
    const stepLoc = findStepDefinitionLocation(title, FEATURE_FILE_RE.test(String(hint)) ? hint : undefined)
    if (stepLoc) {
      Object.assign(testStats, stepLoc)
      return
    }
  }

  // Mocha/Jasmine static mapping via AST
  const file =
    (testStats as any).file ||
    (Array.isArray((testStats as any).specs) ? (testStats as any).specs[0] : undefined) ||
    (testStats as any).specFile ||
    hintFile ||
    CURRENT_SPEC_FILE

  if (file && !FEATURE_FILE_RE.test(file)) {
    if (!_astCache.has(file)) {
      try {
        _astCache.set(file, findTestLocations(file))
      } catch {
        // ignore parse errors
      }
    }
    const locs = _astCache.get(file) as any[] | undefined
    if (locs?.length) {
      let match =
        locs.find(l => l.type === 'test' && l.name === title && fullTitle.includes(l.titlePath.join(' '))) ||
        locs.find(l => l.type === 'test' && l.name === title)

      if (match) {
        Object.assign(testStats, { file, line: match.line, column: match.column })
        return
      }
    }

    // Fallback: plain text search for it/test/specify("<title>")
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
 * Enrich a suite with file + line
 * - Mocha/Jasmine: map "describe/context" by title path using AST
 * - Cucumber: find Feature/Scenario line in .feature file
 */
export function mapSuiteToSource(
  suiteStats: any,
  hintFile?: string,
  suitePath: string[] = []
) {
  const title = String(suiteStats?.title ?? '').trim()
  const file = (suiteStats as any).file || hintFile || CURRENT_SPEC_FILE
  if (!title || !file) return

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
    } catch {}
    return
  }

  // Mocha/Jasmine: AST first
  try {
    if (!_astCache.has(file)) _astCache.set(file, findTestLocations(file))
    const locs = _astCache.get(file) as any[] | undefined
    if (locs?.length) {
      const match =
        locs.find(l => l.type === 'suite'
          && Array.isArray(l.titlePath)
          && l.titlePath.length === suitePath.length
          && l.titlePath.every((t: string, i: number) => t === suitePath[i])) ||
        locs.find(l => l.type === 'suite' && l.titlePath.at(-1) === title)

      if (match?.line) {
        Object.assign(suiteStats, { file, line: match.line, column: match.column })
        return
      }
    }
  } catch {
    // ignore
  }

  // Fallback: text search
  const textLoc = findSuiteLocationByText(file, title)
  if (textLoc) {
    Object.assign(suiteStats, textLoc)
  }
}
