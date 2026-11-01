import { describe, expect, it } from 'vitest'

import {
  NIGHTWATCH_CONFIG_FILENAMES,
  WDIO_CONFIG_FILENAMES
} from '../src/runner.js'

describe('config file names', () => {
  it('prefers a TypeScript WebdriverIO config', () => {
    expect(WDIO_CONFIG_FILENAMES[0]).toBe('wdio.conf.ts')
    expect(
      WDIO_CONFIG_FILENAMES.every((name) => name.startsWith('wdio.conf.'))
    ).toBe(true)
  })

  it('prefers a CommonJS Nightwatch config and falls back to its JSON form', () => {
    expect(NIGHTWATCH_CONFIG_FILENAMES[0]).toBe('nightwatch.conf.cjs')
    expect(NIGHTWATCH_CONFIG_FILENAMES.at(-1)).toBe('nightwatch.json')
  })

  it('names no file in both lists, so a search over both cannot misread one runner', () => {
    const wdio: readonly string[] = WDIO_CONFIG_FILENAMES
    expect(
      NIGHTWATCH_CONFIG_FILENAMES.some((name) => wdio.includes(name))
    ).toBe(false)
  })
})
