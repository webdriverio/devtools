// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest'

import { ScreencastRecordings } from '../src/components/browser/screencast-recordings.js'

describe('ScreencastRecordings', () => {
  it('starts empty in snapshot mode', () => {
    const recordings = new ScreencastRecordings()

    expect(recordings.items).toEqual([])
    expect(recordings.activeIndex).toBe(0)
    expect(recordings.viewMode).toBe('snapshot')
    expect(recordings.active).toBeUndefined()
    expect(recordings.activeUrl).toBeNull()
  })

  it('appends recordings, selects the latest, and switches to video mode', () => {
    const recordings = new ScreencastRecordings()

    recordings.add({ sessionId: 'sess-1', startTime: 1000, duration: 2500 })
    recordings.add({ sessionId: 'sess-2' })

    expect(recordings.items).toEqual([
      {
        sessionId: 'sess-1',
        url: '/api/video/sess-1',
        startTime: 1000,
        duration: 2500
      },
      {
        sessionId: 'sess-2',
        url: '/api/video/sess-2',
        startTime: undefined,
        duration: undefined
      }
    ])
    expect(recordings.activeIndex).toBe(1)
    expect(recordings.viewMode).toBe('video')
    expect(recordings.activeUrl).toBe('/api/video/sess-2')
  })

  it('validates indices and reports whether selection or mode changed', () => {
    const recordings = new ScreencastRecordings()
    recordings.add({ sessionId: 'sess-1' })
    recordings.add({ sessionId: 'sess-2' })

    expect(recordings.setViewMode('video')).toBe(false)
    expect(recordings.setViewMode('snapshot')).toBe(true)
    expect(recordings.viewMode).toBe('snapshot')

    expect(recordings.select(0)).toBe(true)
    expect(recordings.activeIndex).toBe(0)
    expect(recordings.viewMode).toBe('video')

    expect(recordings.select(0)).toBe(false)
    expect(recordings.select(-1)).toBe(false)
    expect(recordings.select(2)).toBe(false)
    expect(recordings.select(Number.NaN)).toBe(false)
    expect(recordings.activeIndex).toBe(0)
  })

  it('resets back to an empty snapshot state and reports whether anything cleared', () => {
    const recordings = new ScreencastRecordings()
    expect(recordings.reset()).toBe(false)

    recordings.add({ sessionId: 'sess-1' })
    recordings.add({ sessionId: 'sess-2' })

    expect(recordings.reset()).toBe(true)
    expect(recordings.items).toEqual([])
    expect(recordings.activeIndex).toBe(0)
    expect(recordings.viewMode).toBe('snapshot')
    expect(recordings.activeUrl).toBeNull()
    expect(recordings.reset()).toBe(false)
  })
})
