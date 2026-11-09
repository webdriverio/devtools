import { afterEach, describe, expect, it } from 'vitest'

import { captureMask, configureInputMasking } from '../src/capture-mask.js'

describe('configureInputMasking', () => {
  afterEach(() => {
    configureInputMasking()
  })

  it('masks password fields and names no selectors by default', () => {
    expect(configureInputMasking()).toEqual({ inputs: true, selectors: [] })
    expect(captureMask()).toEqual({ inputs: true, selectors: [] })
  })

  it('keeps the policy an adapter set for every later collector load', () => {
    configureInputMasking({
      maskInputs: false,
      maskSelectors: [' .iban ', '']
    })
    expect(captureMask()).toEqual({ inputs: false, selectors: ['.iban'] })
  })
})
