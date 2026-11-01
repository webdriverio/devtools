import { describe, it, expect } from 'vitest'

import { resolveByteRange } from '../src/video-range.js'

describe('resolveByteRange', () => {
  const TOTAL = 1000

  it('serves the full file when no Range header is present', () => {
    expect(resolveByteRange(undefined, TOTAL)).toEqual({ kind: 'full' })
    expect(resolveByteRange('', TOTAL)).toEqual({ kind: 'full' })
  })

  it('serves the full file for a malformed Range header', () => {
    expect(resolveByteRange('bytes=abc', TOTAL)).toEqual({ kind: 'full' })
    expect(resolveByteRange('seconds=0-1', TOTAL)).toEqual({ kind: 'full' })
  })

  it('resolves a fully specified range inclusively', () => {
    expect(resolveByteRange('bytes=100-199', TOTAL)).toEqual({
      kind: 'partial',
      start: 100,
      end: 199
    })
  })

  it('treats an open-ended range as start→EOF', () => {
    expect(resolveByteRange('bytes=500-', TOTAL)).toEqual({
      kind: 'partial',
      start: 500,
      end: 999
    })
  })

  it('treats a missing start as 0→end (browsers send 0- to probe seekability)', () => {
    expect(resolveByteRange('bytes=0-', TOTAL)).toEqual({
      kind: 'partial',
      start: 0,
      end: 999
    })
  })

  it('rejects ranges past the end of the file as unsatisfiable', () => {
    expect(resolveByteRange('bytes=1000-2000', TOTAL)).toEqual({
      kind: 'unsatisfiable'
    })
    expect(resolveByteRange('bytes=0-1000', TOTAL)).toEqual({
      kind: 'unsatisfiable'
    })
  })

  it('rejects an inverted range as unsatisfiable', () => {
    expect(resolveByteRange('bytes=300-100', TOTAL)).toEqual({
      kind: 'unsatisfiable'
    })
  })
})
