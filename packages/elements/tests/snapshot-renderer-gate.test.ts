import { beforeEach, describe, expect, it, vi } from 'vitest'

const installed = vi.hoisted(() => ({
  version: undefined as string | undefined
}))

vi.mock('../src/package-version.js', async (importActual) => ({
  ...(await importActual<Record<string, unknown>>()),
  packageVersionOf: vi.fn(() => installed.version)
}))

async function resolvesWdioSnapshot(): Promise<boolean> {
  vi.resetModules()
  const { resolvesWdioSnapshot } = await import('../src/wdio-snapshot.js')
  return resolvesWdioSnapshot()
}

describe('resolvesWdioSnapshot', () => {
  beforeEach(() => {
    installed.version = undefined
  })

  it('keeps the legacy renderer when @wdio/snapshot 10.1 is resolved', async () => {
    installed.version = '10.1.0'

    expect(await resolvesWdioSnapshot()).toBe(false)
  })

  it('uses the snapshot renderer when @wdio/snapshot 10.2 prerelease is resolved', async () => {
    installed.version = '10.2.0-rc.1'

    expect(await resolvesWdioSnapshot()).toBe(true)
  })

  it('keeps the legacy renderer when the resolved version is unreadable', async () => {
    installed.version = undefined

    expect(await resolvesWdioSnapshot()).toBe(false)
  })
})
