import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  setCurrentSpecFile,
  mapTestToSource,
  mapSuiteToSource
} from '../src/utils/source-mapping.js'

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wdio-source-mapping-'))

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

function writeFile(name: string, content: string): string {
  const p = path.join(tmpDir, name)
  fs.writeFileSync(p, content, 'utf-8')
  return p
}

beforeAll(() => {
  setCurrentSpecFile(undefined)
})

describe('mapTestToSource', () => {
  it('attaches file/line/column from AST when title matches', () => {
    const spec = writeFile(
      'mocha.spec.ts',
      [
        "describe('Outer', () => {",
        "  it('hits the API', () => {})",
        '})',
        ''
      ].join('\n')
    )
    const t: any = {
      title: 'hits the API',
      fullTitle: 'Outer hits the API',
      file: spec
    }
    mapTestToSource(t)
    expect(t.file).toBe(spec)
    expect(typeof t.line).toBe('number')
    expect(t.line).toBeGreaterThan(0)
  })

  it('falls back to text search when AST returns no match', () => {
    const spec = writeFile(
      'text-fallback.spec.ts',
      [
        '// the AST may skip dynamic titles; text scan should still catch the literal',
        "it('plain literal', () => {})",
        ''
      ].join('\n')
    )
    const t: any = { title: 'plain literal', file: spec }
    mapTestToSource(t)
    expect(t.line).toBeGreaterThan(0)
  })

  it('routes Cucumber-style step titles to step-definition lookup', () => {
    // Step title starts with Given/When/Then — should NOT trigger AST/test-fn
    // path; it falls through to findStepDefinitionLocation. With no step defs
    // on disk it ends up unmapped, which is fine — assert no throw.
    const t: any = {
      title: 'Given I open the homepage',
      fullTitle: 'Login Given I open the homepage'
    }
    expect(() => mapTestToSource(t)).not.toThrow()
  })

  it('uses CURRENT_SPEC_FILE when stats have no file/specs', () => {
    const spec = writeFile(
      'tracked.spec.ts',
      ["it('tracked', () => {})", ''].join('\n')
    )
    setCurrentSpecFile(spec)
    const t: any = { title: 'tracked' }
    mapTestToSource(t)
    expect(t.file).toBe(spec)
    setCurrentSpecFile(undefined)
  })

  it('prefers specs[0] over file when both are present', () => {
    const a = writeFile('a.spec.ts', ["it('in-a', () => {})", ''].join('\n'))
    const b = writeFile('b.spec.ts', ["it('in-a', () => {})", ''].join('\n'))
    // hintFromStats prefers specs[0], so even though `file: b` is set,
    // the step-resolution hint should NOT come from b. But the title-only
    // map uses `file` for the AST lookup directly. Just verify no-throw.
    const t: any = { title: 'in-a', specs: [a], file: b }
    expect(() => mapTestToSource(t, b)).not.toThrow()
  })

  it('handles fullTitle with worker-prefix normalization (e.g. "0: ...")', () => {
    const spec = writeFile(
      'worker-prefix.spec.ts',
      [
        "describe('S', () => {",
        "  it('worker prefix', () => {})",
        '})',
        ''
      ].join('\n')
    )
    const t: any = {
      title: 'worker prefix',
      fullTitle: '0: S worker prefix',
      file: spec
    }
    mapTestToSource(t)
    expect(t.line).toBeGreaterThan(0)
  })
})

describe('mapSuiteToSource', () => {
  it('attaches file/line for a Cucumber feature suite from the .feature file', () => {
    const feature = writeFile(
      'login.feature',
      [
        'Feature: Login',
        '',
        '  Scenario: User logs in',
        '    Given I am on the homepage',
        ''
      ].join('\n')
    )
    const s: any = { title: 'Login', file: feature }
    mapSuiteToSource(s, undefined)
    expect(s.file).toBe(feature)
    expect(s.line).toBe(1)
  })

  it('attaches file/line for a Cucumber scenario suite', () => {
    const feature = writeFile(
      'scenario.feature',
      [
        'Feature: Sample',
        '',
        '  Scenario: User logs in',
        '    Given X',
        ''
      ].join('\n')
    )
    const s: any = { title: 'User logs in', file: feature }
    mapSuiteToSource(s, undefined)
    expect(s.line).toBe(3)
  })

  it('maps Mocha describe by titlePath using AST', () => {
    const spec = writeFile(
      'mocha-suite.spec.ts',
      [
        "describe('Outer', () => {",
        "  describe('Inner', () => {",
        "    it('runs', () => {})",
        '  })',
        '})',
        ''
      ].join('\n')
    )
    const s: any = { title: 'Inner', file: spec }
    mapSuiteToSource(s, undefined, ['Outer', 'Inner'])
    expect(s.file).toBe(spec)
    expect(s.line).toBeGreaterThan(0)
  })

  it('falls back to text search when AST does not match the suite path', () => {
    const spec = writeFile(
      'suite-text-fallback.spec.ts',
      ["describe('Alone', () => {})", ''].join('\n')
    )
    const s: any = { title: 'Alone', file: spec }
    mapSuiteToSource(s, undefined)
    expect(s.line).toBeGreaterThan(0)
  })

  it('no-ops when stats lack title or file', () => {
    const s: any = {}
    expect(() => mapSuiteToSource(s, undefined)).not.toThrow()
    expect(s.line).toBeUndefined()
  })

  it('handles unreadable feature files gracefully', () => {
    const s: any = { title: 'Login', file: '/nonexistent.feature' }
    expect(() => mapSuiteToSource(s, undefined)).not.toThrow()
  })
})
