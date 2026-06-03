import { describe, expect, it } from 'vitest'
import type { RunnerRequestBody } from '@wdio/devtools-shared'
import { getFilterBuilder } from '../src/framework-filters.js'

function payload(
  overrides: Partial<RunnerRequestBody> = {}
): RunnerRequestBody {
  return {
    entryType: 'test',
    label: '',
    framework: 'mocha',
    ...overrides
  } as RunnerRequestBody
}

describe('getFilterBuilder fallback (DEFAULT_FILTERS)', () => {
  it('passes --spec when specArg is given', () => {
    const fn = getFilterBuilder(undefined)
    expect(fn({ specArg: '/a.test.ts', payload: payload() })).toEqual([
      '--spec',
      '/a.test.ts'
    ])
  })

  it('returns [] when no specArg is given', () => {
    const fn = getFilterBuilder(undefined)
    expect(fn({ specArg: undefined, payload: payload() })).toEqual([])
  })

  it('uses default for unknown runner ids', () => {
    const fn = getFilterBuilder('unknown-runner' as never)
    expect(fn({ specArg: '/x.ts', payload: payload() })).toEqual([
      '--spec',
      '/x.ts'
    ])
  })
})

describe('mocha filter builder', () => {
  const fn = getFilterBuilder('mocha')

  it('adds --spec + --mochaOpts.grep when both are set', () => {
    expect(
      fn({ specArg: '/a.test.ts', payload: payload({ fullTitle: 'Login >' }) })
    ).toEqual(['--spec', '/a.test.ts', '--mochaOpts.grep', 'Login >'])
  })

  it('omits --mochaOpts.grep when fullTitle is empty', () => {
    expect(fn({ specArg: '/a.test.ts', payload: payload() })).toEqual([
      '--spec',
      '/a.test.ts'
    ])
  })

  it('omits --spec when specArg is undefined', () => {
    expect(
      fn({ specArg: undefined, payload: payload({ fullTitle: 'X' }) })
    ).toEqual(['--mochaOpts.grep', 'X'])
  })
})

describe('jasmine filter builder', () => {
  const fn = getFilterBuilder('jasmine')
  it('mirrors mocha shape with --jasmineOpts.grep', () => {
    expect(
      fn({ specArg: '/a.ts', payload: payload({ fullTitle: 'A' }) })
    ).toEqual(['--spec', '/a.ts', '--jasmineOpts.grep', 'A'])
  })
})

describe('nightwatch filter builder', () => {
  const fn = getFilterBuilder('nightwatch')

  it('strips trailing :line from specArg (Nightwatch does not support it)', () => {
    expect(
      fn({
        specArg: '/a.test.ts:42',
        payload: payload({ entryType: 'test', label: 'should pass' })
      })
    ).toEqual(['/a.test.ts', '--testcase', 'should pass'])
  })

  it('passes positional spec without --testcase for suite entryType', () => {
    expect(
      fn({
        specArg: '/a.test.ts',
        payload: payload({ entryType: 'suite' as never })
      })
    ).toEqual(['/a.test.ts'])
  })

  it('returns empty filters when no specArg and no label', () => {
    expect(fn({ specArg: undefined, payload: payload() })).toEqual([])
  })
})

describe('cucumber filter builder', () => {
  const fn = getFilterBuilder('cucumber')

  it('feature-level: strips line and runs the whole feature', () => {
    expect(
      fn({
        specArg: '/login.feature:10',
        payload: payload({ suiteType: 'feature' as never })
      })
    ).toEqual(['--spec', '/login.feature'])
  })

  it('scenario file:line takes priority when feature/line are provided', () => {
    expect(
      fn({
        specArg: '/a.feature',
        payload: payload({
          featureFile: '/login.feature',
          featureLine: 12
        } as never)
      })
    ).toEqual(['--spec', '/login.feature:12'])
  })

  it('test entry with row number: uses anchored regex --cucumberOpts.name', () => {
    const result = fn({
      specArg: '/login.feature',
      payload: payload({
        entryType: 'test',
        fullTitle: '3: User signs in with valid creds'
      } as never)
    })
    expect(result).toEqual([
      '--spec',
      '/login.feature',
      '--cucumberOpts.name',
      '^3:\\s*User signs in with valid creds$'
    ])
  })

  it('test entry with no row prefix uses plain name filter', () => {
    const result = fn({
      specArg: '/login.feature',
      payload: payload({
        entryType: 'test',
        fullTitle: 'Plain scenario'
      } as never)
    })
    expect(result).toEqual([
      '--spec',
      '/login.feature',
      '--cucumberOpts.name',
      'Plain scenario'
    ])
  })

  it('test entry with non-numeric prefix falls back to plain name', () => {
    const result = fn({
      specArg: '/login.feature',
      payload: payload({
        entryType: 'test',
        fullTitle: 'foo: bar'
      } as never)
    })
    // colon present but rowNumber is "foo" not digits → plain name path
    expect(result.slice(-2)).toEqual(['--cucumberOpts.name', 'foo: bar'])
  })

  it('suite-level: only spec, no name filter', () => {
    expect(
      fn({
        specArg: '/login.feature',
        payload: payload({ entryType: 'suite' as never })
      })
    ).toEqual(['--spec', '/login.feature'])
  })

  it('escapes regex metacharacters in scenario name', () => {
    const result = fn({
      specArg: '/x.feature',
      payload: payload({
        entryType: 'test',
        fullTitle: '1: a.b*c'
      } as never)
    })
    expect(result[result.length - 1]).toBe('^1:\\s*a\\.b\\*c$')
  })
})

describe('nightwatch-cucumber filter builder', () => {
  const fn = getFilterBuilder('nightwatch-cucumber')

  it('adds --name with anchored regex for scenario-level reruns', () => {
    expect(
      fn({ specArg: undefined, payload: payload({ fullTitle: 'My Scenario' }) })
    ).toEqual(['--name', '^My Scenario$'])
  })

  it('skips --name for feature-level (suiteType=feature)', () => {
    expect(
      fn({
        specArg: undefined,
        payload: payload({
          suiteType: 'feature' as never,
          fullTitle: 'unused'
        })
      })
    ).toEqual([])
  })

  it('skips --name when runAll is set', () => {
    expect(
      fn({
        specArg: undefined,
        payload: payload({ runAll: true as never, fullTitle: 'unused' })
      })
    ).toEqual([])
  })

  it('escapes regex metacharacters in the scenario name', () => {
    expect(
      fn({ specArg: undefined, payload: payload({ fullTitle: 'a.b*c' }) })
    ).toEqual(['--name', '^a\\.b\\*c$'])
  })
})
