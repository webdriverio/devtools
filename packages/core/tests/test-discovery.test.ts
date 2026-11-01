import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  findTestDefinitions,
  findTestLineInFile
} from '../src/test-discovery.js'

let tmpDir: string

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-discovery-'))
})
afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

function write(filename: string, contents: string): string {
  const p = path.join(tmpDir, filename)
  fs.writeFileSync(p, contents, 'utf-8')
  return p
}

describe('findTestDefinitions', () => {
  it('finds describe + it + test + specify with line numbers', () => {
    const p = write(
      'a.spec.ts',
      [
        '',
        "describe('outer', () => {",
        "  it('first', () => {})",
        "  test('second', () => {})",
        "  specify('third', () => {})",
        '})'
      ].join('\n')
    )
    expect(findTestDefinitions(p)).toEqual([
      { kind: 'suite', title: 'outer', line: 2 },
      { kind: 'test', title: 'first', line: 3 },
      { kind: 'test', title: 'second', line: 4 },
      { kind: 'test', title: 'third', line: 5 }
    ])
  })

  it('also accepts suite/context aliases for describe', () => {
    const p = write(
      'a.spec.ts',
      ["suite('s', () => {", "  context('c', () => {})", '})'].join('\n')
    )
    expect(findTestDefinitions(p).map((d) => d.kind)).toEqual([
      'suite',
      'suite'
    ])
  })

  it('returns empty for missing or unreadable files', () => {
    expect(findTestDefinitions('/nope/missing.ts')).toEqual([])
  })

  it('skips Nightwatch object-style by default', () => {
    const p = write(
      'a.spec.ts',
      ["'my test': () => {},", "'another': async function () {}"].join('\n')
    )
    expect(findTestDefinitions(p)).toEqual([])
  })

  it('includes Nightwatch object-style when opted in', () => {
    const p = write(
      'a.spec.ts',
      ["'my test': () => {},", "'another': async function () {}"].join('\n')
    )
    expect(
      findTestDefinitions(p, { includeNightwatchObjectStyle: true })
    ).toEqual([
      { kind: 'test', title: 'my test', line: 1 },
      { kind: 'test', title: 'another', line: 2 }
    ])
  })
})

describe('findTestLineInFile', () => {
  it('returns the line for a matching test', () => {
    const p = write(
      'a.spec.ts',
      ["it('first', () => {})", "it('second', () => {})"].join('\n')
    )
    expect(findTestLineInFile(p, 'second')).toBe(2)
  })

  it('returns the line for a matching suite when kind=suite', () => {
    const p = write(
      'a.spec.ts',
      ["it('hidden', () => {})", "describe('the suite', () => {})"].join('\n')
    )
    expect(findTestLineInFile(p, 'the suite', 'suite')).toBe(2)
  })

  it('returns null when title not found', () => {
    const p = write('a.spec.ts', "it('only', () => {})")
    expect(findTestLineInFile(p, 'missing')).toBe(null)
  })
})
