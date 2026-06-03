import { describe, expect, it } from 'vitest'
import type { Metadata } from '@wdio/devtools-shared'
import {
  getCapabilityWarning,
  getConfigPath,
  getFramework,
  getLaunchCommand,
  getRerunCommand,
  getRunCapabilities,
  getRunDisabledReason,
  isRunDisabled,
  isRunDisabledDetail
} from '../src/components/sidebar/runnerCapabilities.js'
import type {
  TestEntry,
  TestRunDetail
} from '../src/components/sidebar/types.js'

function md(options: Record<string, unknown> = {}): Metadata {
  return { options } as unknown as Metadata
}

function entry(type: 'test' | 'suite'): TestEntry {
  return { type, uid: 'u', title: 't' } as TestEntry
}
function detail(entryType: 'test' | 'suite'): TestRunDetail {
  return { entryType, uid: 'u' } as TestRunDetail
}

describe('getFramework', () => {
  it('reads options.framework', () => {
    expect(getFramework(md({ framework: 'wdio' }))).toBe('wdio')
  })
  it('undefined when metadata missing', () => {
    expect(getFramework(undefined)).toBeUndefined()
  })
})

describe('getRunCapabilities', () => {
  it('returns explicit runCapabilities merged over defaults', () => {
    const caps = getRunCapabilities(
      md({ runCapabilities: { canRunTests: false } })
    )
    expect(caps).toEqual({
      canRunSuites: true,
      canRunTests: false,
      canRunAll: true
    })
  })

  it('falls back to FRAMEWORK_CAPABILITIES by name', () => {
    expect(getRunCapabilities(md({ framework: 'cucumber' })).canRunTests).toBe(
      false
    )
  })

  it('returns DEFAULT_CAPABILITIES when framework unknown', () => {
    expect(getRunCapabilities(md({ framework: 'unknown-x' }))).toEqual({
      canRunSuites: true,
      canRunTests: true,
      canRunAll: true
    })
  })
})

describe('isRunDisabled / isRunDisabledDetail', () => {
  it('disables test runs when canRunTests is false', () => {
    const m = md({ runCapabilities: { canRunTests: false } })
    expect(isRunDisabled(m, entry('test'))).toBe(true)
    expect(isRunDisabledDetail(m, detail('test'))).toBe(true)
    expect(isRunDisabled(m, entry('suite'))).toBe(false)
  })

  it('disables suite runs when canRunSuites is false', () => {
    const m = md({ runCapabilities: { canRunSuites: false } })
    expect(isRunDisabled(m, entry('suite'))).toBe(true)
    expect(isRunDisabledDetail(m, detail('suite'))).toBe(true)
    expect(isRunDisabled(m, entry('test'))).toBe(false)
  })
})

describe('getRunDisabledReason', () => {
  it('returns undefined when run is allowed', () => {
    expect(getRunDisabledReason(md({}), entry('test'))).toBeUndefined()
  })
  it('phrases reason per type', () => {
    const m = md({ runCapabilities: { canRunTests: false } })
    expect(getRunDisabledReason(m, entry('test'))).toContain('Single-test')
    const m2 = md({ runCapabilities: { canRunSuites: false } })
    expect(getRunDisabledReason(m2, entry('suite'))).toContain('Suite')
  })
})

describe('getCapabilityWarning', () => {
  it('phrases warning per detail entryType', () => {
    expect(getCapabilityWarning(detail('test'))).toContain('Single-test')
    expect(getCapabilityWarning(detail('suite'))).toContain('Suite')
  })
})

describe('config + command getters', () => {
  it('getConfigPath prefers configFilePath over configFile', () => {
    expect(getConfigPath(md({ configFilePath: '/a', configFile: '/b' }))).toBe(
      '/a'
    )
    expect(getConfigPath(md({ configFile: '/b' }))).toBe('/b')
    expect(getConfigPath(md({}))).toBeUndefined()
  })

  it('getRerunCommand / getLaunchCommand pluck from options', () => {
    expect(getRerunCommand(md({ rerunCommand: 'a' }))).toBe('a')
    expect(getLaunchCommand(md({ launchCommand: 'b' }))).toBe('b')
    expect(getRerunCommand(undefined)).toBeUndefined()
    expect(getLaunchCommand(undefined)).toBeUndefined()
  })
})
