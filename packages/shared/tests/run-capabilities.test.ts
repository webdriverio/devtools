import { describe, expect, it } from 'vitest'

import {
  DEFAULT_CAPABILITIES,
  FRAMEWORK_CAPABILITIES,
  resolveRunCapabilities,
  runnerOf
} from '../src/run-capabilities.js'
import type { Metadata } from '../src/types.js'

const metadata = (fields: Partial<Metadata>): Metadata =>
  ({ type: 'testrunner', ...fields }) as Metadata

describe('runnerOf', () => {
  it('prefers the typed runner and falls back to the option', () => {
    expect(
      runnerOf(metadata({ runner: 'mocha', options: { framework: 'x' } }))
    ).toBe('mocha')
    expect(runnerOf(metadata({ options: { framework: 'nightwatch' } }))).toBe(
      'nightwatch'
    )
    expect(runnerOf(undefined)).toBeUndefined()
  })
})

describe('resolveRunCapabilities', () => {
  it('lets a declaration override the defaults field by field', () => {
    expect(
      resolveRunCapabilities(
        metadata({
          runner: 'mocha',
          options: { runCapabilities: { canRunAll: false } }
        })
      )
    ).toEqual({ ...DEFAULT_CAPABILITIES, canRunAll: false })
  })

  it("falls back to the runner's defaults, whatever the case of its id", () => {
    expect(
      resolveRunCapabilities(
        metadata({ options: { framework: 'Nightwatch-Cucumber' } })
      )
    ).toEqual(FRAMEWORK_CAPABILITIES['nightwatch-cucumber'])
  })

  it('falls back to the global defaults for an unlisted or unknown runner', () => {
    expect(resolveRunCapabilities(metadata({ runner: 'mocha' }))).toEqual(
      DEFAULT_CAPABILITIES
    )
    expect(resolveRunCapabilities(undefined)).toEqual(DEFAULT_CAPABILITIES)
  })
})
