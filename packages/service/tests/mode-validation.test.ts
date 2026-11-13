import { describe, expect, it } from 'vitest'
import DevToolsHookService from '../src/index.js'
import { DevToolsAppLauncher } from '../src/launcher.js'

const MESSAGE =
  'Unknown DevTools mode "Trace"; expected one of: live, trace, telemetry'

describe('service mode validation', () => {
  it('throws at launcher construction for an unknown mode', () => {
    expect(() => new DevToolsAppLauncher({ mode: 'Trace' as never })).toThrow(
      MESSAGE
    )
  })

  it('throws at worker service construction for an unknown mode', () => {
    expect(() => new DevToolsHookService({ mode: 'Trace' as never })).toThrow(
      MESSAGE
    )
  })
})
