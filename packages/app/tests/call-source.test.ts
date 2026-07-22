import { describe, expect, it } from 'vitest'
import {
  parseCallSource,
  fileBasename,
  pathSegments,
  normalizeSourcePath,
  resolveSourceFile,
  listSourceFiles
} from '../src/components/workbench/call-source.js'

describe('parseCallSource', () => {
  it('parses file:line', () => {
    expect(parseCallSource('/a/b/login.e2e.ts:24')).toEqual({
      file: '/a/b/login.e2e.ts',
      line: 24
    })
  })

  it('parses file:line:column, keeping only the line', () => {
    expect(parseCallSource('/a/b/login.e2e.ts:24:11')).toEqual({
      file: '/a/b/login.e2e.ts',
      line: 24
    })
  })

  it('tolerates Windows drive paths', () => {
    expect(parseCallSource('C:\\tests\\login.ts:42:5')).toEqual({
      file: 'C:\\tests\\login.ts',
      line: 42
    })
  })

  it('returns null without a trailing line number', () => {
    expect(parseCallSource('/a/b/login.e2e.ts')).toBeNull()
    expect(parseCallSource('')).toBeNull()
  })
})

describe('fileBasename', () => {
  it('returns the last POSIX segment', () => {
    expect(fileBasename('/a/b/login.page.ts')).toBe('login.page.ts')
  })

  it('returns the last Windows segment', () => {
    expect(fileBasename('C:\\tests\\login.ts')).toBe('login.ts')
  })

  it('returns the input when there is no separator', () => {
    expect(fileBasename('login.ts')).toBe('login.ts')
  })
})

describe('pathSegments', () => {
  it('splits a POSIX path, dropping empties', () => {
    expect(pathSegments('/a/b/c.ts')).toEqual(['a', 'b', 'c.ts'])
  })

  it('splits a Windows path', () => {
    expect(pathSegments('C:\\a\\b.ts')).toEqual(['C:', 'a', 'b.ts'])
  })
})

describe('normalizeSourcePath', () => {
  it('returns a clean path unchanged', () => {
    expect(normalizeSourcePath('/a/b/steps.ts')).toBe('/a/b/steps.ts')
  })

  it('strips a glued :line suffix', () => {
    expect(normalizeSourcePath('/a/b/steps.ts:17')).toBe('/a/b/steps.ts')
  })

  it('strips a glued :line:column suffix', () => {
    expect(normalizeSourcePath('/a/b/steps.ts:17:21')).toBe('/a/b/steps.ts')
  })

  it('keeps Windows drive separators intact', () => {
    expect(normalizeSourcePath('C:\\tests\\login.ts:42:5')).toBe(
      'C:\\tests\\login.ts'
    )
    expect(normalizeSourcePath('C:\\tests\\login.ts')).toBe(
      'C:\\tests\\login.ts'
    )
  })

  it('leaves a leading-colon-only string unchanged', () => {
    expect(normalizeSourcePath(':12')).toBe(':12')
  })
})

describe('resolveSourceFile', () => {
  const content = 'export {}'

  it('returns an exact key match', () => {
    expect(resolveSourceFile({ '/a/steps.ts': content }, '/a/steps.ts')).toBe(
      '/a/steps.ts'
    )
  })

  it('matches a suffixed key from a clean query', () => {
    expect(
      resolveSourceFile({ '/a/steps.ts:17': content }, '/a/steps.ts')
    ).toBe('/a/steps.ts:17')
  })

  it('matches a clean key from a suffixed query', () => {
    expect(
      resolveSourceFile({ '/a/steps.ts': content }, '/a/steps.ts:17:21')
    ).toBe('/a/steps.ts')
  })

  it('returns undefined when nothing matches', () => {
    expect(resolveSourceFile({ '/a/steps.ts': content }, '/a/other.ts')).toBe(
      undefined
    )
    expect(resolveSourceFile({}, '/a/steps.ts')).toBe(undefined)
  })
})

describe('listSourceFiles', () => {
  const content = 'export {}'

  it('lists normalized source keys', () => {
    expect(listSourceFiles({ '/a/steps.ts:17': content }, [])).toEqual([
      '/a/steps.ts'
    ])
  })

  it('adds files referenced only by call sources', () => {
    expect(
      listSourceFiles({ '/a/steps.ts': content }, [
        '/a/steps.ts:17:21',
        '/a/other.ts:3',
        undefined
      ])
    ).toEqual(['/a/steps.ts', '/a/other.ts'])
  })

  it('deduplicates by normalized path', () => {
    expect(
      listSourceFiles({ '/a/steps.ts:17': content, '/a/steps.ts:23': 'x' }, [
        '/a/steps.ts:23:3'
      ])
    ).toEqual(['/a/steps.ts'])
  })

  it('ignores call sources without a line number', () => {
    expect(listSourceFiles({}, ['/a/steps.ts'])).toEqual([])
  })
})
