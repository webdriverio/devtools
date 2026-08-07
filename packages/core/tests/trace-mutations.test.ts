import { describe, it, expect } from 'vitest'
import {
  buildMutationsNdjson,
  reattributeDomAnchors
} from '@wdio/devtools-core'
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

describe('reattributeDomAnchors', () => {
  const anchor = (timestamp: number, url = 'https://example.com/a') =>
    mutation({
      type: 'childList',
      url,
      addedNodes: [{ tag: 'html' }],
      timestamp
    })
  const at = (ts: number) => () => ts

  it('pulls a drain-stamped anchor back to the command that produced it', () => {
    const batch = [anchor(9625)]
    reattributeDomAnchors(batch, at(8568), 8566)
    expect(batch[0]!.timestamp).toBe(8568)
  })

  it("resolves the action from the anchor's own time, not the draining call", () => {
    // The navigation's own drain runs against the page it is leaving, so a later
    // command's drain collects the anchor — the resolver must key on the anchor.
    const seen: number[] = []
    const batch = [anchor(7860)]
    reattributeDomAnchors(batch, (t) => {
      seen.push(t)
      return 7858
    })
    expect(seen).toEqual([7860])
    expect(batch[0]!.timestamp).toBe(7858)
  })

  it('leaves observed diffs alone — only full-document anchors move', () => {
    const diff = mutation({ type: 'attributes', target: '35', timestamp: 8600 })
    reattributeDomAnchors([diff], at(100), 0)
    expect(diff.timestamp).toBe(8600)
  })

  it('never pulls an anchor ahead of the document it replaces', () => {
    // The prior page's field edits are already at 5131; replay would apply those
    // stale refs to the new tree if the anchor landed before them.
    const batch = [anchor(6509)]
    reattributeDomAnchors(batch, at(4871), 5131)
    expect(batch[0]!.timestamp).toBe(5131)
  })

  it('never pushes an anchor later than the page stamped it', () => {
    const batch = [anchor(4259)]
    reattributeDomAnchors(batch, at(99999), 0)
    expect(batch[0]!.timestamp).toBe(4259)
  })

  it('leaves the anchor untouched when no action resolves', () => {
    const batch = [anchor(4259)]
    reattributeDomAnchors(batch, () => undefined, 0)
    expect(batch[0]!.timestamp).toBe(4259)
  })

  it('keeps the batch ascending across two anchors', () => {
    const batch = [
      anchor(5000, 'https://example.com/one'),
      mutation({ type: 'attributes', target: '35', timestamp: 5200 }),
      anchor(6000, 'https://example.com/two')
    ]
    reattributeDomAnchors(batch, at(1000), 0)
    expect(batch.map((m) => m.timestamp)).toEqual([1000, 5200, 5200])
  })

  it('is a no-op on a batch with no anchors', () => {
    const batch = [
      mutation({ type: 'characterData', target: '7', timestamp: 42 })
    ]
    reattributeDomAnchors(batch, at(1), 0)
    expect(batch[0]!.timestamp).toBe(42)
  })
})
