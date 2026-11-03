import { describe, it, expect } from 'vitest'
import { capturedPageState, finalFrameStamp } from '@wdio/devtools-core'

const commands = [
  { command: 'url', timestamp: 90 },
  { command: 'click', timestamp: 120 },
  { command: 'getText', timestamp: 130 },
  { command: 'isDisplayed', timestamp: 140 }
]

describe('finalFrameStamp', () => {
  it('returns null when the test logged no rows', () => {
    expect(finalFrameStamp([], 100, undefined)).toBeNull()
  })

  it('returns null when every row predates the test', () => {
    expect(finalFrameStamp(commands, 200, 150)).toBeNull()
  })

  it('stamps the last row when no capture was taken in this test', () => {
    expect(finalFrameStamp(commands, 100, 50)).toEqual({
      timestamp: 140,
      command: 'isDisplayed'
    })
    expect(finalFrameStamp(commands, 100, undefined)).toEqual({
      timestamp: 140,
      command: 'isDisplayed'
    })
  })

  it('stamps the last capture when reads followed it', () => {
    expect(finalFrameStamp(commands, 100, 120)).toEqual({
      timestamp: 120,
      command: 'click'
    })
  })

  it('returns null when the test ends on the capturing command', () => {
    expect(finalFrameStamp(commands, 100, 140)).toBeNull()
  })

  it('names the last row at or before the capture when no row sits on it', () => {
    expect(finalFrameStamp(commands, 100, 125)).toEqual({
      timestamp: 125,
      command: 'click'
    })
  })
})

describe('capturedPageState', () => {
  it('holds for a capture that read a screenshot', () => {
    expect(
      capturedPageState({ timestamp: 1, command: 'click', screenshot: 'PNG' })
    ).toBe(true)
  })

  it('fails for a url-only capture, which has no image to pair the url with', () => {
    expect(
      capturedPageState({ timestamp: 1, command: 'click', url: 'https://a/' })
    ).toBe(false)
  })

  it('fails for a hollow capture from a session that had already ended', () => {
    expect(
      capturedPageState({
        timestamp: 1,
        command: 'click',
        snapshotText: '[Page]',
        elements: []
      })
    ).toBe(false)
    expect(
      capturedPageState({
        timestamp: 1,
        command: 'click',
        url: '',
        screenshot: ''
      })
    ).toBe(false)
  })
})
