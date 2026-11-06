import { describe, expect, it } from 'vitest'
import { installedWebdriverioVersion } from '../src/webdriverio-version.js'
import { rendersWithWdioSnapshot } from '../src/snapshot-version.js'

describe('rendersWithWdioSnapshot', () => {
  it.each(['9.32.0', '10.1.0', '10.1.9'])(
    'keeps the legacy renderer on %s',
    (version) => {
      expect(rendersWithWdioSnapshot(version)).toBe(false)
    }
  )

  it.each(['10.2.0-beta.1', '10.2.0-rc.1', '10.2.0', '11.0.0'])(
    'renders with @wdio/snapshot on %s',
    (version) => {
      expect(rendersWithWdioSnapshot(version)).toBe(true)
    }
  )

  it.each(['garbage', '', undefined])(
    'falls back to legacy for an unreadable version %j',
    (version) => {
      expect(rendersWithWdioSnapshot(version)).toBe(false)
    }
  )
})

describe('installedWebdriverioVersion', () => {
  it('reads the webdriverio version the package resolves', () => {
    expect(installedWebdriverioVersion()).toMatch(/^\d+\.\d+\.\d+/)
  })
})
