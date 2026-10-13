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
    headless: false,
    captureScreenshots: true,
    filmstrip: true,
    mode: 'live'
  }
}

// A JS caller can hand configure() anything, whatever the type says.
function untyped(opts: Record<string, unknown>): DevToolsOptions {
  return opts as DevToolsOptions
}

describe('applyConfigureOptions', () => {
  it('applies the options configure() used to drop', () => {
    const target = defaults()
    const warnings = applyConfigureOptions(target, {
      port: 4123,
      hostname: '127.0.0.1',
      captureScreenshots: false,
      filmstrip: false,
      emitArtifactsManifest: true
    })
    expect(warnings).toEqual([])
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

  it('refuses a string where a boolean belongs, so "false" cannot turn headless on', () => {
    const target = defaults()
    const warnings = applyConfigureOptions(
      target,
      untyped({ headless: 'false', openUi: 'true', captureAssertions: 'yes' })
    )
    expect(target.headless).toBe(false)
    expect(target.openUi).toBe(true)
    expect('captureAssertions' in target).toBe(false)
    expect(warnings).toEqual([
      "configure: ignoring openUi: expected a boolean, got 'true'",
      "configure: ignoring headless: expected a boolean, got 'false'",
      "configure: ignoring captureAssertions: expected a boolean, got 'yes'"
    ])
  })

  it('refuses an empty or non-string choice', () => {
    const target = defaults()
    const warnings = applyConfigureOptions(
      target,
      untyped({ mode: '', traceFormat: 1 })
    )
    expect(target.mode).toBe('live')
    expect('traceFormat' in target).toBe(false)
    expect(warnings).toEqual([
      "configure: ignoring mode: expected a non-empty string, got ''",
      'configure: ignoring traceFormat: expected a non-empty string, got 1'
    ])
  })

  it('treats an explicit undefined or null as "not specified"', () => {
    const target = defaults()
    const warnings = applyConfigureOptions(
      target,
      untyped({
        emitArtifactsManifest: undefined,
        traceFormat: null,
        port: null
      })
    )
    expect(warnings).toEqual([])
    expect(target).toEqual(defaults())
    expect('emitArtifactsManifest' in target).toBe(false)
  })

  it('refuses an invalid port but still applies a valid hostname', () => {
    const target = defaults()
    const warnings = applyConfigureOptions(target, {
      port: Number('not-a-port'),
      hostname: '0.0.0.0'
    })
    expect(warnings).toEqual([
      'configure: ignoring port: expected an integer between 1 and 65535, got NaN'
    ])
    expect(target.port).toBe(3000)
    expect(target.hostname).toBe('0.0.0.0')
  })

  it('refuses port/hostname once the backend start has begun, and says why', () => {
    const target = defaults()
    const warnings = applyConfigureOptions(
      target,
      { port: 4123, hostname: 'example.test', filmstrip: false },
      'started'
    )
    expect(target.port).toBe(3000)
    expect(target.hostname).toBe('localhost')
    expect(target.filmstrip).toBe(false)
    expect(warnings).toEqual([
      'configure: ignoring port/hostname: the backend start has already begun'
    ])
  })

  it("keeps a reused parent backend's port/hostname without warning", () => {
    const target = defaults()
    const warnings = applyConfigureOptions(
      target,
      { port: 4123, openUi: false },
      'reuse'
    )
    expect(warnings).toEqual([])
    expect(target.port).toBe(3000)
    expect(target.openUi).toBe(false)
  })

  it('does not warn under a lock when port/hostname were not asked for', () => {
    expect(
      applyConfigureOptions(defaults(), { openUi: false }, 'started')
    ).toEqual([])
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
