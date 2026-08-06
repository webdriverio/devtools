import { describe, it, expect } from 'vitest'
import { NightwatchDevToolsPlugin } from '../src/index.js'
import type { DevToolsOptions } from '../src/types.js'

/** `options` is `private`, which is compile-time only — the constructor's
 *  resolved option bag IS the unit under test here, so read it structurally. */
function resolved(options: DevToolsOptions): Required<DevToolsOptions> {
  const plugin = new NightwatchDevToolsPlugin(options)
  return (plugin as unknown as { options: Required<DevToolsOptions> }).options
}

describe('filmstrip recorder gate', () => {
  it('starts the recorder when filmstrip is left at its default', () => {
    // Regression: the gate read the RAW `options.filmstrip === true`, so an
    // unset filmstrip left the recorder off while the resolved options claimed
    // it was on — no dense frames unless a config said `filmstrip: true`.
    const opts = resolved({ mode: 'trace' })
    expect(opts.filmstrip).toBe(true)
    expect(opts.screencast.enabled).toBe(true)
  })

  it('starts the recorder when filmstrip is set explicitly', () => {
    const opts = resolved({ mode: 'trace', filmstrip: true })
    expect(opts.screencast.enabled).toBe(true)
  })

  it('leaves the recorder off when filmstrip is opted out', () => {
    const opts = resolved({ mode: 'trace', filmstrip: false })
    expect(opts.filmstrip).toBe(false)
    expect(opts.screencast.enabled).not.toBe(true)
  })

  it('starts the recorder for a video policy even with filmstrip off', () => {
    const opts = resolved({
      mode: 'trace',
      filmstrip: false,
      video: 'retain-on-failure'
    })
    expect(opts.screencast.enabled).toBe(true)
  })

  it('does not force the recorder on in live mode', () => {
    const opts = resolved({ mode: 'live' })
    expect(opts.screencast.enabled).not.toBe(true)
  })
})
