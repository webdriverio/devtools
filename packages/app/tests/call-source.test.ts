import { describe, expect, it } from 'vitest'
import {
  parseCallSource,
  fileBasename,
  pathSegments
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
