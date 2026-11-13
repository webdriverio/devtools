import { describe, expect, it, vi } from 'vitest'

const warn = vi.hoisted(() => vi.fn())
vi.mock('@wdio/logger', () => ({
  default: () => ({ info: vi.fn(), warn, error: vi.fn(), debug: vi.fn() })
}))
vi.mock('../src/helpers/detachedBackend.js', () => ({
  startDetachedBackend: vi.fn()
}))

const { DevTools } = await import('../src/index.js')

describe('configure', () => {
  it('names what a trace-mode configure ignores with the shared warning', () => {
    warn.mockClear()
    DevTools.configure({ mode: 'trace', screencast: { enabled: true } })
    expect(warn).toHaveBeenCalledWith(
      expect.stringMatching(/^trace mode ignores `screencast\.enabled`/)
    )
    expect(warn).not.toHaveBeenCalledWith(
      expect.stringContaining('ignoring screencast option')
    )
  })

  it('names trace-only keys a telemetry configure ignores', () => {
    warn.mockClear()
    DevTools.configure({ mode: 'telemetry', video: 'on' })
    expect(warn).toHaveBeenCalledWith(
      'telemetry mode ignores `video` (trace mode only).'
    )
  })
})
