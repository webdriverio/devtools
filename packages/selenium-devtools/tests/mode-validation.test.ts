import { describe, expect, it, vi } from 'vitest'
import { DevTools } from '../src/index.js'

vi.mock('../src/helpers/detachedBackend.js', () => ({
  startDetachedBackend: vi.fn()
}))

describe('selenium mode validation', () => {
  it('throws from configure for an unknown mode', () => {
    expect(() => DevTools.configure({ mode: 'Trace' as never })).toThrow(
      'Unknown DevTools mode "Trace"; expected one of: live, trace, telemetry'
    )
  })
})
