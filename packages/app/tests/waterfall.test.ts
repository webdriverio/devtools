import { describe, expect, it } from 'vitest'
import type { NetworkRequest } from '@wdio/devtools-shared'
import {
  networkWindow,
  waterfallBar
} from '../src/components/workbench/network/waterfall.js'

function req(partial: Partial<NetworkRequest>): NetworkRequest {
  return {
    id: 'x',
    url: 'https://example.com',
    method: 'GET',
    timestamp: 0,
    startTime: 0,
    type: 'xhr',
    ...partial
  } as NetworkRequest
}

describe('networkWindow', () => {
  it('returns the longest request duration', () => {
    const scale = networkWindow([
      req({ time: 100 }),
      req({ time: 400 }),
      req({ startTime: 0, endTime: 250 }) // derived duration 250
    ])
    expect(scale).toEqual({ maxDuration: 400 })
  })

  it('derives duration from start/end when time is absent', () => {
    expect(networkWindow([req({ startTime: 10, endTime: 60 })])).toEqual({
      maxDuration: 50
    })
  })

  it('returns 0 for no timed requests', () => {
    expect(networkWindow([])).toEqual({ maxDuration: 0 })
    expect(networkWindow([req({})])).toEqual({ maxDuration: 0 })
  })
})

describe('waterfallBar', () => {
  const scale = { maxDuration: 1000 }

  it('scales width proportionally to the slowest request, always from the left', () => {
    expect(waterfallBar(req({ time: 1000 }), scale)).toEqual({
      offset: 0,
      width: 100
    })
    expect(waterfallBar(req({ time: 500 }), scale)).toEqual({
      offset: 0,
      width: 50
    })
  })

  it('gives a tiny-but-timed request a visible minimum width', () => {
    expect(waterfallBar(req({ time: 1 }), scale).width).toBe(2)
  })

  it('returns width 0 for untimed requests (row shows a dash instead)', () => {
    expect(waterfallBar(req({}), scale)).toEqual({ offset: 0, width: 0 })
    expect(waterfallBar(req({ time: 0 }), scale)).toEqual({
      offset: 0,
      width: 0
    })
  })

  it('returns width 0 when nothing has a duration', () => {
    expect(waterfallBar(req({ time: 100 }), { maxDuration: 0 })).toEqual({
      offset: 0,
      width: 0
    })
  })
})
