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
  FEATURE_FILE_RE
} from '../constants.js'

const require = createRequire(import.meta.url)
const traverse = (
  require('@babel/traverse') as {
    default: (parent: BabelNode, opts?: TraverseOptions) => void
  }
).default

export interface Loc {
  type: 'test' | 'suite'
  name: string
  titlePath: string[]
  line?: number
  column?: number
}

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
