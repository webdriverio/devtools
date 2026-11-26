import { describe, expect, it, vi } from 'vitest'
import { NightwatchDevToolsPlugin } from '../src/index.js'

vi.mock('@wdio/devtools-backend', () => ({ start: vi.fn(), stop: vi.fn() }))

describe('nightwatch mode validation', () => {
  it('throws at plugin construction for an unknown mode', () => {
    expect(
      () => new NightwatchDevToolsPlugin({ mode: 'Trace' as never })
    ).toThrow(
      'Unknown DevTools mode "Trace"; expected one of: live, trace, telemetry'
    )
  })
})
