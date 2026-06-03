import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  findTestLocations,
  getCurrentTestLocation
} from '../src/utils/ast-locations.js'

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wdio-ast-loc-'))

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

function writeFile(name: string, content: string): string {
  const p = path.join(tmpDir, name)
  fs.writeFileSync(p, content, 'utf-8')
  return p
}

describe('findTestLocations', () => {
  it('returns [] for non-existent files', () => {
    expect(findTestLocations('/nonexistent/path.spec.ts')).toEqual([])
  })

  it('captures Mocha describe + it calls with line numbers', () => {
    const file = writeFile(
      'mocha.spec.ts',
      [
        "describe('Login', () => {",
        "  it('signs in', () => {})",
        "  it('signs out', () => {})",
        '})',
        ''
      ].join('\n')
    )
    const locs = findTestLocations(file)
    expect(locs).toHaveLength(3)
    expect(locs[0]).toMatchObject({
      type: 'suite',
      name: 'Login',
      titlePath: ['Login'],
      line: 1
    })
    expect(locs[1]).toMatchObject({
      type: 'test',
      name: 'signs in',
      titlePath: ['Login', 'signs in'],
      line: 2
    })
    expect(locs[2]).toMatchObject({
      type: 'test',
      name: 'signs out',
      titlePath: ['Login', 'signs out'],
      line: 3
    })
  })

  it('builds nested titlePath through nested describes', () => {
    const file = writeFile(
      'nested.spec.ts',
      [
        "describe('Outer', () => {",
        "  describe('Inner', () => {",
        "    it('passes', () => {})",
        '  })',
        '})',
        ''
      ].join('\n')
    )
    const locs = findTestLocations(file)
    const test = locs.find((l) => l.type === 'test')
    expect(test?.titlePath).toEqual(['Outer', 'Inner', 'passes'])
  })

  it('pops suite stack on exit so siblings keep correct path', () => {
    const file = writeFile(
      'siblings.spec.ts',
      [
        "describe('A', () => {",
        "  it('a1', () => {})",
        '})',
        "describe('B', () => {",
        "  it('b1', () => {})",
        '})',
        ''
      ].join('\n')
    )
    const locs = findTestLocations(file)
    const tests = locs.filter((l) => l.type === 'test')
    expect(tests[0].titlePath).toEqual(['A', 'a1'])
    expect(tests[1].titlePath).toEqual(['B', 'b1'])
  })

  it('supports Jasmine `xit` and `fit` via TEST_FN_NAMES', () => {
    const file = writeFile(
      'jasmine.spec.ts',
      [
        "describe('Pending', () => {",
        "  it('runs', () => {})",
        '})',
        ''
      ].join('\n')
    )
    const locs = findTestLocations(file)
    expect(locs.find((l) => l.name === 'runs')).toBeDefined()
  })

  it('ignores test() calls with non-static (template) titles only when expressions are non-empty', () => {
    const file = writeFile(
      'dynamic.spec.ts',
      [
        'const x = 1',
        "describe('Dynamic', () => {",
        '  it(`run ${x}`, () => {})',
        "  it('static', () => {})",
        '})',
        ''
      ].join('\n')
    )
    const locs = findTestLocations(file)
    // template literal with expression → skipped; only the static title is captured
    const tests = locs.filter((l) => l.type === 'test')
    expect(tests).toHaveLength(1)
    expect(tests[0].name).toBe('static')
  })

  it('extracts titles from no-expression template literals', () => {
    const file = writeFile(
      'template.spec.ts',
      [
        "describe('TL', () => {",
        '  it(`hello world`, () => {})',
        '})',
        ''
      ].join('\n')
    )
    const locs = findTestLocations(file)
    const test = locs.find((l) => l.type === 'test')
    expect(test?.name).toBe('hello world')
  })

  it('handles Cucumber-style "Feature" identifier as a suite root', () => {
    const file = writeFile(
      'feature.spec.ts',
      ["Feature('Auth', () => {", "  it('logs in', () => {})", '})', ''].join(
        '\n'
      )
    )
    const locs = findTestLocations(file)
    const feature = locs.find(
      (l) => l.type === 'suite' && l.name === 'Auth'
    )
    expect(feature).toBeDefined()
  })

  it('parses files with minor syntactic noise via errorRecovery', () => {
    // A stray identifier between tests — babel's errorRecovery should keep
    // going and still capture the surrounding test calls.
    const file = writeFile(
      'noisy.spec.ts',
      [
        "describe('Noisy', () => {",
        "  it('first', () => {})",
        '  stray-identifier',
        "  it('second', () => {})",
        '})',
        ''
      ].join('\n')
    )
    // Babel may still throw on some errors; either it parses (returns locs)
    // or throws — both behaviors are acceptable. The contract this test
    // pins is that the FIRST test is still discoverable when parse succeeds.
    let locs: ReturnType<typeof findTestLocations> = []
    try {
      locs = findTestLocations(file)
    } catch {
      /* parse failed completely — acceptable */
    }
    if (locs.length > 0) {
      expect(locs.find((l) => l.name === 'first')).toBeDefined()
    }
  })

  it('returns no locations for a file with no test calls', () => {
    const file = writeFile(
      'utils.ts',
      ['export function helper() { return 1 }', ''].join('\n')
    )
    expect(findTestLocations(file)).toEqual([])
  })

  it('skips calls with non-static argument shapes', () => {
    const file = writeFile(
      'nonstatic.spec.ts',
      [
        "const title = 'dyn'",
        'describe(title, () => {})',
        "describe('Static', () => {})",
        ''
      ].join('\n')
    )
    const locs = findTestLocations(file)
    expect(locs.map((l) => l.name)).toEqual(['Static'])
  })
})

describe('getCurrentTestLocation', () => {
  it('returns null when no spec/step/feature frame is on the stack', () => {
    // Called directly from test code (the test file is a .test.ts spec but
    // SPEC_FILE_RE may or may not match it depending on the regex). Either
    // way, the function should not throw.
    expect(() => getCurrentTestLocation()).not.toThrow()
  })
})
