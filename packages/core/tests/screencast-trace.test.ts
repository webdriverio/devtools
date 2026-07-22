import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import type { ScreencastFrame } from '@wdio/devtools-shared'
import {
  thinScreencastFrames,
  buildDenseScreencast
} from '../src/screencast-trace.js'

/** base64 of a distinct payload per label, so identical labels are byte-equal. */
function frame(label: string, timestamp: number): ScreencastFrame {
  return { data: Buffer.from(label).toString('base64'), timestamp }
}

function sha1Name(label: string): string {
  const hex = createHash('sha1').update(Buffer.from(label)).digest('hex')
  return `${hex}.jpeg`
}

describe('thinScreencastFrames', () => {
  it('keeps frames at least the min interval apart', () => {
    const frames = [
      frame('a', 0),
      frame('b', 40),
      frame('c', 90),
      frame('d', 150),
      frame('e', 210)
    ]
    const kept = thinScreencastFrames(frames, { minFrameIntervalMs: 100 })
    // 0 kept; 40,90 dropped (<100 since last kept 0); 150 kept; 210 dropped.
    expect(kept.map((f) => f.timestamp)).toEqual([0, 150])
  })

  it('drops consecutive byte-identical frames (static run collapses)', () => {
    const frames = [
      frame('same', 0),
      frame('same', 200),
      frame('same', 400),
      frame('changed', 600)
    ]
    const kept = thinScreencastFrames(frames, { minFrameIntervalMs: 100 })
    expect(kept.map((f) => f.timestamp)).toEqual([0, 600])
  })

  it('keeps a repeated frame that is not consecutive (A B A)', () => {
    const frames = [frame('a', 0), frame('b', 200), frame('a', 400)]
    const kept = thinScreencastFrames(frames, { minFrameIntervalMs: 100 })
    expect(kept.map((f) => f.timestamp)).toEqual([0, 200, 400])
  })

  it('downsamples to the cap while keeping first and last', () => {
    const frames = Array.from({ length: 50 }, (_, i) => frame(`f${i}`, i * 200))
    const kept = thinScreencastFrames(frames, {
      maxFrames: 10,
      minFrameIntervalMs: 100
    })
    expect(kept).toHaveLength(10)
    expect(kept[0]!.timestamp).toBe(0)
    expect(kept[kept.length - 1]!.timestamp).toBe(49 * 200)
  })

  it('returns empty for empty input', () => {
    expect(thinScreencastFrames([])).toEqual([])
  })

  it('handles maxFrames<=1 without producing undefined holes', () => {
    const frames = [frame('a', 0), frame('b', 200), frame('c', 400)]
    const kept = thinScreencastFrames(frames, {
      maxFrames: 1,
      minFrameIntervalMs: 100
    })
    expect(kept).toEqual([frames[0]])
    // and buildDenseScreencast must not throw on that result
    expect(() =>
      buildDenseScreencast(
        frames,
        'page@x',
        0,
        { width: 1, height: 1 },
        {
          maxFrames: 1,
          minFrameIntervalMs: 100
        }
      )
    ).not.toThrow()
  })
})

describe('buildDenseScreencast', () => {
  const viewport = { width: 800, height: 600 }

  it('rebases timestamps against wallTime and never goes negative', () => {
    const frames = [frame('a', 1000), frame('b', 1300)]
    const { events } = buildDenseScreencast(frames, 'page@x', 1000, viewport, {
      minFrameIntervalMs: 100
    })
    expect(events.map((e) => e.timestamp)).toEqual([0, 300])
    expect(events.every((e) => e.type === 'screencast-frame')).toBe(true)
    expect(events[0]!.pageId).toBe('page@x')
    expect(events[0]!.width).toBe(800)
  })

  it('content-addresses frames and dedupes identical bytes to one resource', () => {
    // Two distinct frames plus one that repeats the first's bytes non-adjacently.
    const frames = [frame('img-a', 0), frame('img-b', 200), frame('img-a', 400)]
    const { events, resources } = buildDenseScreencast(
      frames,
      'page@x',
      0,
      viewport,
      { minFrameIntervalMs: 100 }
    )
    // three events, but only two unique resources (img-a shared).
    expect(events).toHaveLength(3)
    expect(resources).toHaveLength(2)
    expect(events[0]!.sha1).toBe(sha1Name('img-a'))
    expect(events[2]!.sha1).toBe(sha1Name('img-a'))
    expect(events[0]!.sha1).toBe(events[2]!.sha1)
    expect(new Set(resources.map((r) => r.resourceName)).size).toBe(2)
  })

  it('returns empty events and resources for no frames (byte-stable)', () => {
    expect(buildDenseScreencast([], 'page@x', 0, viewport)).toEqual({
      events: [],
      resources: []
    })
  })

  it('resource bytes decode back to the source frame data', () => {
    const { resources } = buildDenseScreencast(
      [frame('hello', 0)],
      'page@x',
      0,
      viewport
    )
    expect(resources[0]!.data.toString()).toBe('hello')
  })
})
