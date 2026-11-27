import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import url from 'node:url'
import ts from 'typescript'
import { describe, it, expect } from 'vitest'

const packagesDir = path.resolve(
  url.fileURLToPath(new URL('.', import.meta.url)),
  '..',
  '..'
)

// `@wdio/elements` checks its own declarations in its package's tests.
const PUBLISHED = [
  'service',
  'backend',
  'selenium-devtools',
  'nightwatch-devtools',
  'trace-query'
]

// A private workspace package by name, or any path back into `packages/`: neither exists where a consumer installs the package.
const UNPUBLISHED_IMPORT =
  /(?:from|import\()\s*['"](?:@wdio\/devtools-(?:core|shared|trace)(?:['"/])|(?:\.\.\/)+packages\/)/

function declarationFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) {
    return []
  }
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      return declarationFiles(full)
    }
    return /\.d\.c?ts$/.test(entry.name) ? [full] : []
  })
}

describe('published type declarations', () => {
  it.each(PUBLISHED)('%s imports no unpublished package', (name) => {
    const distDir = path.join(packagesDir, name, 'dist')
    const files = declarationFiles(distDir)
    if (files.length === 0) {
      return
    }
    const leaks = files.flatMap((file) =>
      fs
        .readFileSync(file, 'utf8')
        .split('\n')
        .filter((line) => UNPUBLISHED_IMPORT.test(line))
        .map((line) => `${path.relative(packagesDir, file)}: ${line.trim()}`)
    )
    expect(leaks).toEqual([])
  })

  it('declares every type entry the service exports map names', () => {
    const service = path.join(packagesDir, 'service')
    if (!fs.existsSync(path.join(service, 'dist'))) {
      return
    }
    const exportsMap = JSON.parse(
      fs.readFileSync(path.join(service, 'package.json'), 'utf8')
    ).exports as Record<string, { types?: string }>
    const missing = Object.values(exportsMap)
      .map((entry) => entry.types)
      .filter((types): types is string => typeof types === 'string')
      .filter((types) => !fs.existsSync(path.join(service, types)))
    expect(missing).toEqual([])
  })

  // An unresolved base makes `ServiceOptions` lose its members or degrade to `any`, which the import scan cannot see.
  it('types the service options a consumer writes', () => {
    const declarations = path.join(packagesDir, 'service', 'dist', 'types.d.ts')
    if (!fs.existsSync(declarations)) {
      return
    }
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'devtools-consumer-'))
    const consumer = path.join(dir, 'wdio.conf.ts')
    fs.writeFileSync(
      consumer,
      [
        `import type { ServiceOptions } from ${JSON.stringify(declarations.replace(/\.d\.ts$/, '.js'))}`,
        "export const valid: ServiceOptions = { mode: 'trace', traceGranularity: 'test', maskInputs: false }",
        '// @ts-expect-error not a DevTools mode',
        "export const invalid: ServiceOptions = { mode: 'nonsense' }"
      ].join('\n')
    )
    const program = ts.createProgram([consumer], {
      noEmit: true,
      strict: true,
      skipLibCheck: true,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      target: ts.ScriptTarget.ES2022
    })
    const errors = ts
      .getPreEmitDiagnostics(program, program.getSourceFile(consumer))
      .map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'))
    fs.rmSync(dir, { recursive: true, force: true })
    expect(errors).toEqual([])
  })
})
