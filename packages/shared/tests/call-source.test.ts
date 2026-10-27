import { describe, expect, it } from 'vitest'

import { parseCallSource } from '../src/call-source.js'

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
