import { describe, expect, it } from 'vitest'
import { SCREENCAST_DEFAULTS } from '@wdio/devtools-shared'
import {
  ScreencastSettings,
  screencastFor
} from '../src/helpers/screencast-options.js'

describe('screencastFor', () => {
  it('keeps the tuning fields outside live mode and drops only enabled', () => {
    expect(
      screencastFor(
        {
          ...SCREENCAST_DEFAULTS,
          enabled: true,
          quality: 40,
          pollIntervalMs: 500
        },
        'trace'
      )
    ).toEqual({
      ...SCREENCAST_DEFAULTS,
      quality: 40,
      pollIntervalMs: 500,
      enabled: false
    })
  })

  it('applies every field in live mode', () => {
    expect(
      screencastFor({ ...SCREENCAST_DEFAULTS, enabled: true }, 'live')
    ).toEqual({ ...SCREENCAST_DEFAULTS, enabled: true })
  })
})

describe('ScreencastSettings', () => {
  it('records again after a live, trace, live toggle, keeping the tuning fields', () => {
    const settings = new ScreencastSettings(
      { enabled: true, quality: 40 },
      'live'
    )
    expect(settings.effective).toMatchObject({ enabled: true, quality: 40 })
    settings.update(undefined, 'trace')
    expect(settings.effective).toMatchObject({ enabled: false, quality: 40 })
    settings.update(undefined, 'live')
    expect(settings.effective).toMatchObject({ enabled: true, quality: 40 })
  })

  it('rejects a write to the options it hands out, which the next update would lose', () => {
    const settings = new ScreencastSettings({ enabled: true }, 'live')
    expect(() => {
      // @ts-expect-error the effective options are read-only
      settings.effective.enabled = false
    }).toThrow(TypeError)
    expect(settings.effective.enabled).toBe(true)
  })

  it('merges each configure call over the earlier input', () => {
    const settings = new ScreencastSettings({ quality: 40 }, 'live')
    settings.update({ pollIntervalMs: 500 }, 'live')
    expect(settings.effective).toMatchObject({
      quality: 40,
      pollIntervalMs: 500,
      enabled: SCREENCAST_DEFAULTS.enabled
    })
  })
})
