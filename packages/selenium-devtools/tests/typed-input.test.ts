import { afterEach, describe, expect, it, vi } from 'vitest'
import { configureSecretRedaction, redactSecrets } from '@wdio/devtools-core'

import { noteTypedIntoElement } from '../src/helpers/typed-input.js'

const SECRET = 'SuperSecretPassword!'

describe('noteTypedIntoElement', () => {
  afterEach(() => {
    configureSecretRedaction({ maskInputs: false })
    configureSecretRedaction()
  })

  it('learns a password typed into a password field', async () => {
    const element = { getProperty: vi.fn(async () => 'password') }
    await noteTypedIntoElement(element, [SECRET], false)
    expect(element.getProperty).toHaveBeenCalledWith('type')
    expect(redactSecrets(SECRET)).toBe('••••')
  })

  it('reads nothing on a native app session', async () => {
    const element = { getProperty: vi.fn(async () => 'password') }
    await noteTypedIntoElement(element, [SECRET], true)
    expect(element.getProperty).not.toHaveBeenCalled()
    expect(redactSecrets(SECRET)).toBe(SECRET)
  })
})
