import { describe, it, expect } from 'vitest'
import { buildMutationsNdjson } from '@wdio/devtools-core'
import {
  isMutationsTruncationMarker,
  type TraceMutation
} from '@wdio/devtools-shared'

function mutation(overrides: Partial<TraceMutation> = {}): TraceMutation {
  return {
    type: 'childList',
    addedNodes: [],
    removedNodes: [],
    timestamp: 1000,
    ...overrides
  }
}

describe('buildMutationsNdjson', () => {
  it('returns an empty buffer for no mutations', () => {
    const result = buildMutationsNdjson([])
    expect(result.ndjson.byteLength).toBe(0)
    expect(result.truncated).toBe(false)
    expect(result.written).toBe(0)
  })

  it('serializes one JSON mutation per line with no marker under the cap', () => {
    const mutations = [
      mutation({ type: 'childList', addedNodes: [{ tag: 'html' }] }),
      mutation({ type: 'attributes', target: 'body', timestamp: 1100 })
    ]
    const result = buildMutationsNdjson(mutations)
    const lines = result.ndjson.toString('utf8').split('\n')
    expect(lines).toHaveLength(2)
    expect(result.written).toBe(2)
    expect(result.truncated).toBe(false)
    expect(lines.some((l) => l.includes('__truncated__'))).toBe(false)
    expect((JSON.parse(lines[0]!) as TraceMutation).addedNodes).toEqual([
      { tag: 'html' }
    ])
  })

  it('keeps the earliest under the cap and appends a truncation marker', () => {
    const mutations = Array.from({ length: 5 }, (_, i) =>
      mutation({ timestamp: 1000 + i, target: `n${i}` })
    )
    // Cap sized to fit exactly the first two mutation lines.
    const cap = buildMutationsNdjson(mutations.slice(0, 2)).ndjson.byteLength
    const result = buildMutationsNdjson(mutations, cap)
    const lines = result.ndjson.toString('utf8').split('\n')
    expect(result.written).toBe(2)
    expect(result.truncated).toBe(true)
    expect(JSON.parse(lines.at(-1)!)).toEqual({
      __truncated__: true,
      dropped: 3
    })
    // Earliest retained, latest dropped.
    expect(result.ndjson.toString('utf8')).toContain('"n0"')
    expect(result.ndjson.toString('utf8')).not.toContain('"n4"')
  })

  it('always emits the first mutation even when it alone exceeds the cap', () => {
    const big = mutation({ addedNodes: [{ html: 'x'.repeat(200) }] })
    const result = buildMutationsNdjson(
      [big, mutation({ timestamp: 2000 })],
      10
    )
    const lines = result.ndjson.toString('utf8').split('\n')
    expect(result.written).toBe(1)
    expect(result.truncated).toBe(true)
    expect(JSON.parse(lines.at(-1)!)).toEqual({
      __truncated__: true,
      dropped: 1
    })
  })
})

describe('isMutationsTruncationMarker', () => {
  it('recognizes the sentinel and rejects mutations / non-objects', () => {
    expect(
      isMutationsTruncationMarker({ __truncated__: true, dropped: 3 })
    ).toBe(true)
    expect(isMutationsTruncationMarker(mutation())).toBe(false)
    expect(isMutationsTruncationMarker({ __truncated__: false })).toBe(false)
    expect(isMutationsTruncationMarker(null)).toBe(false)
    expect(isMutationsTruncationMarker('x')).toBe(false)
  })
})
