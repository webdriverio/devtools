import { describe, it, expect } from 'vitest'
import { trimChar, fileSlug } from '../src/artifact-naming.js'

describe('trimChar', () => {
  it('strips leading and trailing occurrences only', () => {
    expect(trimChar('--a-b--', '-')).toBe('a-b')
    expect(trimChar('__x__', '_')).toBe('x')
  })

  it('returns empty for an all-char string', () => {
    expect(trimChar('-----', '-')).toBe('')
  })

  it('is a no-op when there is nothing to trim', () => {
    expect(trimChar('abc', '-')).toBe('abc')
    expect(trimChar('', '-')).toBe('')
  })

  it('handles long runs without catastrophic backtracking', () => {
    const long = '-'.repeat(100000) + 'x' + '-'.repeat(100000)
    // A polynomial /^-+|-+$/ would stall here; the linear scan returns fast.
    expect(trimChar(long, '-')).toBe('x')
  })
})

describe('fileSlug', () => {
  it('collapses disallowed runs to a single dash and trims edges', () => {
    expect(fileSlug('a/b  c!!d')).toBe('a-b-c-d')
    expect(fileSlug('  spaced  ')).toBe('spaced')
  })

  it('keeps alphanumerics, underscore and dash', () => {
    expect(fileSlug('Test_Case-1')).toBe('Test_Case-1')
  })

  it('stays fast + correct on a long disallowed run', () => {
    expect(fileSlug('a' + ' '.repeat(100000) + 'b')).toBe('a-b')
  })
})
