import { describe, expect, it } from 'vitest'
import { derivedSpanId, PinnedIdGenerator } from '../src/span-ids.js'

describe('PinnedIdGenerator', () => {
  it('serves the pinned ids while pinned and random ids after', () => {
    const ids = new PinnedIdGenerator()
    ids.pin({
      traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
      spanId: '00f067aa0ba902b7'
    })
    expect(ids.generateTraceId()).toBe('4bf92f3577b34da6a3ce929d0e0e4736')
    expect(ids.generateSpanId()).toBe('00f067aa0ba902b7')
    ids.pin(undefined)
    expect(ids.generateTraceId()).toMatch(/^[0-9a-f]{32}$/)
    expect(ids.generateSpanId()).toMatch(/^[0-9a-f]{16}$/)
  })
})

describe('derivedSpanId', () => {
  it('is a stable 16-hex id per root and key', () => {
    const id = derivedSpanId('00f067aa0ba902b7', '3')
    expect(id).toMatch(/^[0-9a-f]{16}$/)
    expect(derivedSpanId('00f067aa0ba902b7', '3')).toBe(id)
    expect(derivedSpanId('00f067aa0ba902b7', '4')).not.toBe(id)
    expect(derivedSpanId('1111222233334444', '3')).not.toBe(id)
  })
})
