import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import path from 'node:path'
import { RUNNER_ENV } from '@wdio/devtools-shared'
import { detectInvocationConfigPath } from '../src/standalone.js'

// Service instantiation in `setupForDevtools` ends up calling start(...) on
// the backend, which is heavy and TTY-dependent — we mock the entry module
// out before importing setupForDevtools below.
vi.mock('../src/index.js', () => {
  return {
    default: class MockHookService {
      captureType = 'standalone'
      beforeSession = vi.fn()
      before = vi.fn()
      beforeCommand = vi.fn()
      afterCommand = vi.fn()
      after = vi.fn(() => Promise.resolve())
    }
  }
})

const ORIGINAL_ARGV = [...process.argv]

describe('detectInvocationConfigPath', () => {
  let originalEnv: string | undefined

  beforeEach(() => {
    originalEnv = process.env[RUNNER_ENV.WDIO_CONFIG]
    delete process.env[RUNNER_ENV.WDIO_CONFIG]
  })

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env[RUNNER_ENV.WDIO_CONFIG]
    } else {
      process.env[RUNNER_ENV.WDIO_CONFIG] = originalEnv
    }
    process.argv = [...ORIGINAL_ARGV]
  })

  it('returns the env override when DEVTOOLS_WDIO_CONFIG is absolute', () => {
    process.env[RUNNER_ENV.WDIO_CONFIG] = '/abs/wdio.conf.ts'
    expect(detectInvocationConfigPath()).toBe('/abs/wdio.conf.ts')
  })

  it('resolves a relative env override against cwd', () => {
    process.env[RUNNER_ENV.WDIO_CONFIG] = './rel/wdio.conf.ts'
    expect(detectInvocationConfigPath()).toBe(
      path.resolve(process.cwd(), './rel/wdio.conf.ts')
    )
  })

  it('finds --config in argv', () => {
    process.argv = ['node', 'wdio', '--config', '/x/wdio.conf.ts']
    expect(detectInvocationConfigPath()).toBe('/x/wdio.conf.ts')
  })

  it('finds -c in argv', () => {
    process.argv = ['node', 'wdio', '-c', '/y/wdio.conf.js']
    expect(detectInvocationConfigPath()).toBe('/y/wdio.conf.js')
  })

  it('accepts wdio.config.ts as an alternate extension via --config', () => {
    process.argv = ['node', 'wdio', '--config', '/z/wdio.config.mjs']
    expect(detectInvocationConfigPath()).toBe('/z/wdio.config.mjs')
  })

  it('resolves a relative --config value against cwd', () => {
    process.argv = ['node', 'wdio', '--config', './sub/wdio.conf.ts']
    expect(detectInvocationConfigPath()).toBe(
      path.resolve(process.cwd(), './sub/wdio.conf.ts')
    )
  })

  it('skips --config when the next arg does not look like a config file', () => {
    process.argv = ['node', 'wdio', '--config', 'not-a-config']
    expect(detectInvocationConfigPath()).toBeUndefined()
  })

  it('falls back to a positional wdio.conf.* anywhere in argv', () => {
    process.argv = ['node', 'wdio', 'run', './examples/wdio.conf.ts']
    expect(detectInvocationConfigPath()).toBe(
      path.resolve(process.cwd(), './examples/wdio.conf.ts')
    )
  })

  it('returns undefined when no env, --config, or positional is present', () => {
    process.argv = ['node', 'wdio', 'run']
    expect(detectInvocationConfigPath()).toBeUndefined()
  })

  it('env override takes precedence over argv', () => {
    process.env[RUNNER_ENV.WDIO_CONFIG] = '/env/wdio.conf.ts'
    process.argv = ['node', 'wdio', '--config', '/argv/wdio.conf.ts']
    expect(detectInvocationConfigPath()).toBe('/env/wdio.conf.ts')
  })
})

describe('setupForDevtools', () => {
  it('returns the same opts object with beforeCommand/afterCommand arrays installed', async () => {
    const { setupForDevtools } = await import('../src/standalone.js')
    const opts = {} as any
    const out = setupForDevtools(opts)
    expect(out).toBe(opts)
    expect(Array.isArray(opts.beforeCommand)).toBe(true)
    expect(Array.isArray(opts.afterCommand)).toBe(true)
    expect(opts.beforeCommand.length).toBeGreaterThan(0)
    expect(opts.afterCommand.length).toBeGreaterThan(0)
  })

  it('preserves existing beforeCommand/afterCommand functions in the chain', async () => {
    const { setupForDevtools } = await import('../src/standalone.js')
    const userBefore = vi.fn()
    const userAfter = vi.fn()
    const opts = { beforeCommand: userBefore, afterCommand: userAfter } as any
    setupForDevtools(opts)
    expect(opts.beforeCommand).toContain(userBefore)
    expect(opts.afterCommand).toContain(userAfter)
    // The wrapped versions are pushed AFTER the user hooks.
    expect(opts.beforeCommand[0]).toBe(userBefore)
    expect(opts.afterCommand[0]).toBe(userAfter)
  })

  it('preserves existing beforeCommand/afterCommand arrays in the chain', async () => {
    const { setupForDevtools } = await import('../src/standalone.js')
    const u1 = vi.fn()
    const u2 = vi.fn()
    const opts = { beforeCommand: [u1, u2], afterCommand: [u1, u2] } as any
    setupForDevtools(opts)
    expect(opts.beforeCommand.slice(0, 2)).toEqual([u1, u2])
    expect(opts.afterCommand.slice(0, 2)).toEqual([u1, u2])
  })
})
