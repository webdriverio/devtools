import { afterEach, describe, expect, it, vi } from 'vitest'
import { configureSecretRedaction, secretRedactor } from '@wdio/devtools-core'

import { NightwatchDevToolsPlugin } from '../src/index.js'

describe('Nightwatch secrets', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    configureSecretRedaction()
  })

  it('sets the run’s secrets from the plugin options, an env entry read at start', () => {
    vi.stubEnv('NIGHTWATCH_TEST_SECRET', 'from-the-env')
    new NightwatchDevToolsPlugin({
      secrets: ['SuperSecretPassword!', { env: 'NIGHTWATCH_TEST_SECRET' }]
    })
    expect(secretRedactor()?.secrets).toEqual([
      'SuperSecretPassword!',
      'from-the-env'
    ])
    new NightwatchDevToolsPlugin({})
    expect(secretRedactor()?.secrets).toEqual([])
  })
})
