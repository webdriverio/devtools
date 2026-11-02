import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as NodeModule from 'node:module'
import type * as NodeUrl from 'node:url'
import type * as PackageVersion from '../src/package-version.js'

vi.mock('node:url', async (importActual) => {
  const actual = await importActual<typeof NodeUrl>()
  return { ...actual, fileURLToPath: vi.fn(actual.fileURLToPath) }
})

vi.mock('node:module', async (importActual) => {
  const actual = await importActual<typeof NodeModule>()
  return { ...actual, createRequire: vi.fn(actual.createRequire) }
})

vi.mock('../src/package-version.js', async (importActual) => {
  const actual = await importActual<typeof PackageVersion>()
  return { ...actual, packageVersionOf: vi.fn(actual.packageVersionOf) }
})

function withCode(message: string, code: string): Error {
  return Object.assign(new Error(message), { code })
}

beforeEach(() => {
  vi.resetModules()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('resolvesWdioSnapshot warnings', () => {
  it('warns when resolution fails for a reason other than absence', async () => {
    const { fileURLToPath } = await import('node:url')
    const { resolvesWdioSnapshot } = await import('../src/wdio-snapshot.js')
    vi.mocked(fileURLToPath).mockImplementationOnce(() => {
      throw new Error('bad url')
    })

    expect(resolvesWdioSnapshot()).toBe(false)
    expect(console.warn).toHaveBeenCalledTimes(1)
    expect(vi.mocked(console.warn).mock.calls[0][0]).toContain(
      'could not resolve @wdio/snapshot'
    )
  })

  it('stays silent when @wdio/snapshot is not installed', async () => {
    const { fileURLToPath } = await import('node:url')
    const { resolvesWdioSnapshot } = await import('../src/wdio-snapshot.js')
    vi.mocked(fileURLToPath).mockImplementationOnce(() => {
      throw withCode('Cannot find package', 'ERR_MODULE_NOT_FOUND')
    })

    expect(resolvesWdioSnapshot()).toBe(false)
    expect(console.warn).not.toHaveBeenCalled()
  })

  it('warns when the resolved @wdio/snapshot is below 10.2, once', async () => {
    const { packageVersionOf } = await import('../src/package-version.js')
    const { resolvesWdioSnapshot } = await import('../src/wdio-snapshot.js')
    vi.mocked(packageVersionOf).mockReturnValueOnce('10.1.0')

    expect(resolvesWdioSnapshot()).toBe(false)
    expect(resolvesWdioSnapshot()).toBe(false)
    expect(console.warn).toHaveBeenCalledTimes(1)
    expect(vi.mocked(console.warn).mock.calls[0][0]).toContain(
      '@wdio/snapshot 10.1.0 is installed but the snapshot renderer needs 10.2 or later'
    )
  })
})

describe('installedWebdriverioVersion warnings', () => {
  async function unresolvable(code?: string) {
    const { createRequire } = await import('node:module')
    vi.mocked(createRequire).mockReturnValueOnce({
      resolve: () => {
        throw code ? withCode('no webdriverio', code) : new Error('bad resolve')
      }
    } as unknown as ReturnType<typeof createRequire>)
  }

  it('warns when webdriverio cannot be resolved for a reason other than absence', async () => {
    const { installedWebdriverioVersion } =
      await import('../src/webdriverio-version.js')
    await unresolvable()

    expect(installedWebdriverioVersion()).toBeUndefined()
    expect(console.warn).toHaveBeenCalledTimes(1)
    expect(vi.mocked(console.warn).mock.calls[0][0]).toContain(
      'could not resolve webdriverio'
    )
  })

  it('stays silent when webdriverio is not installed', async () => {
    const { installedWebdriverioVersion } =
      await import('../src/webdriverio-version.js')
    await unresolvable('MODULE_NOT_FOUND')

    expect(installedWebdriverioVersion()).toBeUndefined()
    expect(console.warn).not.toHaveBeenCalled()
  })
})
