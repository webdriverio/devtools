import { describe, expect, it } from 'vitest'
import type { Metadata } from '@wdio/devtools-shared'
import {
  getCapabilityWarning,
  getConfigPath,
  getFramework,
  getLaunchCommand,
  getRerunCommand,
  getRunAllDisabledReason,
  getRunCapabilities,
  getRunDisabledReason,
  isRunAll,
  isRunDisabled,
  isRunDisabledDetail
} from '../src/components/sidebar/runnerCapabilities.js'
import {
  RUN_ALL_REFUSAL,
  RUN_ALL_UID,
  SINGLE_TEST_REFUSAL,
  SUITE_REFUSAL
} from '../src/components/sidebar/constants.js'
import type {
  TestEntry,
  TestRunDetail
} from '../src/components/sidebar/types.js'

function md(options: Record<string, unknown> = {}): Metadata {
  return { options } as unknown as Metadata
}

/** A trace zip's metadata: `runner` comes back off `context-options` and there
 *  are no runner `options` at all. */
function playerMd(runner: string): Metadata {
  return { runner } as unknown as Metadata
}

function entry(type: 'test' | 'suite'): TestEntry {
  return { type, uid: 'u', label: 'u', children: [] }
}
function detail(entryType: 'test' | 'suite'): TestRunDetail {
  return { entryType, uid: 'u' }
}
/** A run-all reaches the same helpers as a suite run — same `entryType`, only
 *  the uid differs. */
function runAllDetail(): TestRunDetail {
  return { entryType: 'suite', uid: RUN_ALL_UID }
}

describe('getFramework', () => {
  it('reads the typed Metadata.runner', () => {
    expect(getFramework(playerMd('nightwatch-cucumber'))).toBe(
      'nightwatch-cucumber'
    )
  })
  it('falls back to options.framework for a stream that carries no runner', () => {
    // A zip recorded before `Metadata.runner` existed, or by a foreign tool.
    expect(getFramework(md({ framework: 'wdio' }))).toBe('wdio')
  })
  it('prefers the typed field when both carry the fact', () => {
    const both = {
      runner: 'nightwatch',
      options: { framework: 'stale' }
    } as unknown as Metadata
    expect(getFramework(both)).toBe('nightwatch')
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

  it('reads the runner off a trace zip, which carries no runner options', () => {
    expect(getRunCapabilities(playerMd('nightwatch'))).toEqual({
      canRunSuites: true,
      canRunTests: true,
      canRunAll: false
    })
  })
})

describe('isRunAll', () => {
  it('recognises the whole-tree sentinel uid', () => {
    expect(isRunAll(runAllDetail())).toBe(true)
  })
  it('is false for a normal entry uid', () => {
    expect(isRunAll(detail('suite'))).toBe(false)
    expect(isRunAll(detail('test'))).toBe(false)
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

  it('judges a run-all against canRunAll, not canRunSuites', () => {
    const noRunAll = md({
      runCapabilities: { canRunAll: false, canRunSuites: true }
    })
    expect(isRunDisabledDetail(noRunAll, runAllDetail())).toBe(true)
    expect(isRunDisabledDetail(noRunAll, detail('suite'))).toBe(false)

    const suitesOnlyRefused = md({
      runCapabilities: { canRunAll: true, canRunSuites: false }
    })
    expect(isRunDisabledDetail(suitesOnlyRefused, runAllDetail())).toBe(false)
    expect(isRunDisabledDetail(suitesOnlyRefused, detail('suite'))).toBe(true)
  })
})

describe('getRunAllDisabledReason', () => {
  it('undefined when the runner can run everything', () => {
    expect(
      getRunAllDisabledReason(md({ framework: 'cucumber' }))
    ).toBeUndefined()
  })
  it('names the run-all refusal when the runner cannot', () => {
    expect(getRunAllDisabledReason(md({ framework: 'nightwatch' }))).toBe(
      RUN_ALL_REFUSAL
    )
  })
})

describe('getRunDisabledReason', () => {
  it('returns undefined when run is allowed', () => {
    expect(getRunDisabledReason(md({}), entry('test'))).toBeUndefined()
  })
  it('phrases reason per type', () => {
    const m = md({ runCapabilities: { canRunTests: false } })
    expect(getRunDisabledReason(m, entry('test'))).toBe(SINGLE_TEST_REFUSAL)
    const m2 = md({ runCapabilities: { canRunSuites: false } })
    expect(getRunDisabledReason(m2, entry('suite'))).toBe(SUITE_REFUSAL)
  })
})

describe('getCapabilityWarning', () => {
  it('phrases warning per detail entryType', () => {
    expect(getCapabilityWarning(detail('test'))).toBe(SINGLE_TEST_REFUSAL)
    expect(getCapabilityWarning(detail('suite'))).toBe(SUITE_REFUSAL)
  })
  it('phrases the run-all warning off the sentinel, not the entryType', () => {
    expect(getCapabilityWarning(runAllDetail())).toBe(RUN_ALL_REFUSAL)
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

  // The exact metadata the Python adapter sends. It services no launch control,
  // and without the explicit refusal the fallback is DEFAULT_CAPABILITIES (all
  // true), so every button renders enabled and fails on click.
  it('refuses every launch control for a python-selenium stream', () => {
    const pythonMetadata = {
      runner: 'selenium-webdriver',
      testEnv: 'python-selenium',
      options: {
        runCapabilities: {
          canRunSuites: false,
          canRunTests: false,
          canRunAll: false
        }
      }
    } as unknown as Metadata

    expect(getFramework(pythonMetadata)).toBe('selenium-webdriver')
    expect(getRunCapabilities(pythonMetadata)).toEqual({
      canRunSuites: false,
      canRunTests: false,
      canRunAll: false
    })
    expect(getRunAllDisabledReason(pythonMetadata)).toBe(RUN_ALL_REFUSAL)
    expect(isRunDisabled(pythonMetadata, { type: 'test' } as TestEntry)).toBe(
      true
    )
    expect(isRunDisabled(pythonMetadata, { type: 'suite' } as TestEntry)).toBe(
      true
    )
  })
})
