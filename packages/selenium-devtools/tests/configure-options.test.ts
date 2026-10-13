import { describe, it, expect } from 'vitest'
import {
  applyConfigureOptions,
  serverLock,
  type ConfigurableOptions
} from '../src/helpers/configure-options.js'
import type { DevToolsOptions } from '../src/types.js'

function defaults(): ConfigurableOptions {
  return {
    port: 3000,
    hostname: 'localhost',
    openUi: true,
    captureScreenshots: true,
    filmstrip: true,
    mode: 'live'
  }
}

describe('applyConfigureOptions', () => {
  it('applies the options configure() used to drop', () => {
    const target = defaults()
    const warning = applyConfigureOptions(target, {
      port: 4123,
      hostname: '127.0.0.1',
      captureScreenshots: false,
      filmstrip: false,
      emitArtifactsManifest: true
    })
    expect(warning).toBeUndefined()
    expect(target).toMatchObject({
      port: 4123,
      hostname: '127.0.0.1',
      captureScreenshots: false,
      filmstrip: false,
      emitArtifactsManifest: true
    })
  })

  it('applies false booleans and leaves unspecified options untouched', () => {
    const target = defaults()
    applyConfigureOptions(target, { openUi: false, mode: 'trace' })
    expect(target).toEqual({ ...defaults(), openUi: false, mode: 'trace' })
  })

  it('treats an explicit undefined or null as "not specified"', () => {
    const target = defaults()
    // A JS caller can hand configure() null even though the type forbids it.
    const loose = {
      emitArtifactsManifest: undefined,
      traceFormat: null,
      port: null
    } as unknown as DevToolsOptions
    expect(applyConfigureOptions(target, loose)).toBeUndefined()
    expect(target).toEqual(defaults())
    expect('emitArtifactsManifest' in target).toBe(false)
  })

  it('refuses an invalid port and keeps the current one', () => {
    const target = defaults()
    const warning = applyConfigureOptions(target, {
      port: Number('not-a-port'),
      hostname: '0.0.0.0'
    })
    expect(warning).toBe('configure: ignoring invalid port NaN')
    expect(target.port).toBe(3000)
    expect(target.hostname).toBe('localhost')
  })

  it('refuses port/hostname once the backend start has begun, and says why', () => {
    const target = defaults()
    const warning = applyConfigureOptions(
      target,
      { port: 4123, hostname: 'example.test', filmstrip: false },
      'started'
    )
    expect(target.port).toBe(3000)
    expect(target.hostname).toBe('localhost')
    expect(target.filmstrip).toBe(false)
    expect(warning).toBe(
      'configure: ignoring port/hostname: the backend start has already begun'
    )
  })

  it("keeps a reused parent backend's port/hostname without warning", () => {
    const target = defaults()
    const warning = applyConfigureOptions(
      target,
      { port: 4123, openUi: false },
      'reuse'
    )
    expect(warning).toBeUndefined()
    expect(target.port).toBe(3000)
    expect(target.openUi).toBe(false)
  })

  it('does not warn under a lock when port/hostname were not asked for', () => {
    expect(
      applyConfigureOptions(defaults(), { openUi: false }, 'started')
    ).toBeUndefined()
  })
})

describe('serverLock', () => {
  it('prefers reuse over a started backend, since a rerun child never binds its own', () => {
    expect(serverLock({ isReuse: true, backendStarting: true })).toBe('reuse')
    expect(serverLock({ isReuse: true, backendStarting: false })).toBe('reuse')
  })

  it('locks once the backend start has begun, and not before', () => {
    expect(serverLock({ isReuse: false, backendStarting: true })).toBe(
      'started'
    )
    expect(
      serverLock({ isReuse: false, backendStarting: false })
    ).toBeUndefined()
  })
})
