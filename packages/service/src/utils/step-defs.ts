import fs from 'fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { parse } from '@babel/parser'
import type {
  Node as BabelNode,
  NodePath,
  TraverseOptions
} from '@babel/traverse'
import type { CallExpression, Identifier, MemberExpression } from '@babel/types'

import {
  PARSE_PLUGINS,
  STEP_FN_NAMES,
  STEP_DEF_REGEX_LITERAL_RE,
  STEP_DEF_STRING_RE,
  SOURCE_FILE_EXT_RE,
  STEPS_DIR_CANDIDATES,
  STEPS_DIR_ASCENT_MAX,
  STEPS_GLOBAL_SEARCH_MAX_DEPTH
} from '../constants.js'
import type { StepDef } from '../types.js'

const require = createRequire(import.meta.url)
const traverse = (
  require('@babel/traverse') as {
    default: (parent: BabelNode, opts?: TraverseOptions) => void
  }
).default

// @cucumber/cucumber-expressions is an optional peer; load lazily. The
// constructor types vary across versions, so we keep the shapes minimal —
// only the constructor signatures we actually call.
interface CucumberExpressionInstance {
  match(text: string): unknown
}
interface CucumberExpressionsModule {
  CucumberExpression: new (
    pattern: string,
    registry: ParameterTypeRegistryInstance
  ) => CucumberExpressionInstance
  ParameterTypeRegistry: new () => ParameterTypeRegistryInstance
}
type ParameterTypeRegistryInstance = object

let CE: CucumberExpressionsModule | undefined
try {
  const ce = require('@cucumber/cucumber-expressions')
  CE = {
    CucumberExpression: ce.CucumberExpression,
    ParameterTypeRegistry: ce.ParameterTypeRegistry
  }
} catch {
  /* optional */
}

// Ascending search from a starting directory.
function findStepsDir(startDir: string): string | undefined {
  let dir = startDir
  for (let i = 0; i < STEPS_DIR_ASCENT_MAX; i++) {
    for (const c of STEPS_DIR_CANDIDATES) {
      const p = path.join(dir, c)
      if (fs.existsSync(p) && fs.statSync(p).isDirectory()) {
        return p
      }
    }
    const up = path.dirname(dir)
    if (up === dir) {
      break
    }
    dir = up
  }
  return undefined
}

// BFS under cwd for a features/*/(step-definitions|steps) directory.
let globalStepsDir: string | undefined
function findStepsDirGlobal(): string | undefined {
  if (globalStepsDir && fs.existsSync(globalStepsDir)) {
    return globalStepsDir
  }

  const root = process.cwd()
  const queue: { dir: string; depth: number }[] = [{ dir: root, depth: 0 }]
  const maxDepth = STEPS_GLOBAL_SEARCH_MAX_DEPTH
  while (queue.length) {
    const { dir, depth } = queue.shift()!
    if (depth > maxDepth) {
      continue
    }

    const featuresDir = path.join(dir, 'features')
    if (fs.existsSync(featuresDir) && fs.statSync(featuresDir).isDirectory()) {
      for (const c of STEPS_DIR_CANDIDATES) {
        const p = path.join(featuresDir, c)
        if (fs.existsSync(p) && fs.statSync(p).isDirectory()) {
          globalStepsDir = p
          return p
        }
      }
    }

    for (const entry of fs.readdirSync(dir)) {
      if (entry.startsWith('.')) {
        continue
      }
      const full = path.join(dir, entry)
      let st: fs.Stats
      try {
        st = fs.statSync(full)
      } catch {
        continue
      }
      if (st.isDirectory() && !full.includes('node_modules')) {
        queue.push({ dir: full, depth: depth + 1 })
      }
    }
  }
  return undefined
}

function listFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of fs.readdirSync(dir)) {
    const full = path.join(dir, entry)
    const st = fs.statSync(full)
    if (st.isDirectory()) {
      out.push(...listFiles(full))
    } else if (SOURCE_FILE_EXT_RE.test(entry)) {
      out.push(full)
    }
  }
  return out
}

// Text fallback: scan a file for step definitions on a single line.
function collectStepDefsFromText(file: string): StepDef[] {
  const out: StepDef[] = []
  const src = fs.readFileSync(file, 'utf-8')
  const lines = src.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const mRe = line.match(STEP_DEF_REGEX_LITERAL_RE)
    if (mRe) {
      const lit = mRe[2]
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
        /* malformed regex */
      }
    }
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

type StepArg =
  | { type: 'RegExpLiteral'; pattern: string; flags?: string }
  | { type: 'StringLiteral'; value: string }
  | { type: string }

function calleeName(callee: CallExpression['callee']): string | undefined {
  if (callee.type === 'Identifier') {
    return (callee as Identifier).name
  }
  if (callee.type === 'MemberExpression') {
    const prop = (callee as MemberExpression).property
    if (prop.type === 'Identifier') {
      return (prop as Identifier).name
    }
  }
  return undefined
}

function pushStepDefFromArg(
  name: string,
  arg: StepArg | undefined,
  loc: { file: string; line: number; column: number },
  defs: StepDef[]
): boolean {
  if (arg?.type === 'RegExpLiteral') {
    const re = arg as { pattern: string; flags?: string }
    defs.push({
      kind: 'regex',
      regex: new RegExp(re.pattern, re.flags ?? ''),
      ...loc
    })
    return true
  }
  if (arg?.type === 'StringLiteral') {
    const sl = arg as { value: string }
    if (CE && sl.value.includes('{')) {
      const expr = new CE!.CucumberExpression(
        sl.value,
        new CE!.ParameterTypeRegistry()
      )
      defs.push({ kind: 'expression', expr, ...loc })
    } else {
      defs.push({ kind: 'string', keyword: name, text: sl.value, ...loc })
    }
    return true
  }
  return false
}

function collectStepDefsFromFile(file: string, defs: StepDef[]): number {
  let pushed = 0
  try {
    const src = fs.readFileSync(file, 'utf-8')
    const ast = parse(src, {
      sourceType: 'module',
      plugins: [...PARSE_PLUGINS],
      errorRecovery: true
    })
    traverse(ast, {
      CallExpression(p: NodePath<CallExpression>) {
        const name = calleeName(p.node.callee)
        if (!name || !(STEP_FN_NAMES as readonly string[]).includes(name)) {
          return
        }
        const arg = p.node.arguments?.[0] as StepArg | undefined
        const loc = {
          file,
          line: p.node.loc?.start.line ?? 1,
          column: p.node.loc?.start.column ?? 0
        }
        if (pushStepDefFromArg(name, arg, loc, defs)) {
          pushed++
        }
      }
    })
  } catch {
    /* AST errors fall through to text scan */
  }
  return pushed
}

const stepsCache = new Map<string, StepDef[]>()
function collectStepDefs(stepsDir: string): StepDef[] {
  const cached = stepsCache.get(stepsDir)
  if (cached) {
    return cached
  }
  const files = listFiles(stepsDir)
  const defs: StepDef[] = []
  for (const file of files) {
    const pushed = collectStepDefsFromFile(file, defs)
    if (pushed === 0) {
      const fromText = collectStepDefsFromText(file)
      if (fromText.length) {
        defs.push(...fromText)
      }
    }
  }
  stepsCache.set(stepsDir, defs)
  return defs
}

/**
 * Resolve a step title (e.g. `Given I open the app`) to the file:line where
 * the Cucumber step definition is declared. Walks up from `hintPath` first
 * (per-feature step dirs), then falls back to a global BFS under cwd.
 */
export function findStepDefinitionLocation(
  stepTitle: string,
  hintPath?: string
): { file: string; line: number; column: number } | undefined {
  const baseDir = hintPath
    ? path.extname(hintPath)
      ? path.dirname(hintPath)
      : hintPath
    : undefined

  let stepsDir = baseDir ? findStepsDir(baseDir) : undefined
  if (!stepsDir) {
    stepsDir = findStepsDirGlobal()
  }
  if (!stepsDir) {
    return
  }

  const defs = collectStepDefs(stepsDir)
  const title = String(stepTitle ?? '').trim()
  const titleNoKw = title.replace(/^(Given|When|Then|And|But)\s+/i, '').trim()
  const match = matchStepDef(defs, title, titleNoKw)
  if (match) {
    return { file: match.file, line: match.line, column: match.column }
  }
  return
}

function matchStepDef(
  defs: StepDef[],
  title: string,
  titleNoKw: string
): StepDef | undefined {
  const s = defs.find(
    (d) =>
      d.kind === 'string' &&
      (titleNoKw.localeCompare(d.text!, 'en', { sensitivity: 'base' }) === 0 ||
        title.localeCompare(`${d.keyword} ${d.text}`, 'en', {
          sensitivity: 'base'
        }) === 0)
  )
  if (s) {
    return s
  }
  const e = defs.find(
    (d) =>
      d.kind === 'expression' &&
      (() => {
        try {
          return !!d.expr!.match(titleNoKw) || !!d.expr!.match(title)
        } catch {
          return false
        }
      })()
  )
  if (e) {
    return e
  }
  return defs.find(
    (d) =>
      d.kind === 'regex' && (d.regex!.test(titleNoKw) || d.regex!.test(title))
  )
}
