import { describe, expect, it } from 'vitest'
import { sourceAround } from '../src/source-lines.js'

const SOURCES = { '/spec.ts': ['a', 'b', 'c', 'd', 'e'].join('\n') }

describe('sourceAround', () => {
  it('numbers the lines around the call, marking its own', () => {
    expect(sourceAround(SOURCES, '/spec.ts:2:7', 1)).toEqual([
      ' 1 | a',
      '>2 | b',
      ' 3 | c'
    ])
  })

  it('stops at the start and end of the file', () => {
    expect(sourceAround(SOURCES, '/spec.ts:5', 3)).toEqual([
      ' 2 | b',
      ' 3 | c',
      ' 4 | d',
      '>5 | e'
    ])
  })

  it('cuts a long line', () => {
    const line = sourceAround({ '/min.js': 'x'.repeat(500) }, '/min.js:1', 0)
    expect(line?.[0]).toMatch(/^>1 \| x+… \(cut, 500 chars\)$/)
  })

  it.each(['/other.ts:1', '/spec.ts', '/spec.ts:9', '/spec.ts:0'])(
    'has no lines for %s',
    (callSource) => {
      expect(sourceAround(SOURCES, callSource, 2)).toBeUndefined()
    }
  )
})
