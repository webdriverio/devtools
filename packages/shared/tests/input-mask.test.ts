import { describe, expect, it } from 'vitest'

import {
  captureMaskPrelude,
  DEFAULT_CAPTURE_MASK,
  MASKED_VALUE,
  resolveCaptureMask,
  scrubTypedValues,
  typedValueForms,
  withCaptureMask
} from '../src/input-mask.js'

describe('resolveCaptureMask', () => {
  it('masks inputs by default and names no selectors', () => {
    expect(resolveCaptureMask()).toEqual(DEFAULT_CAPTURE_MASK)
    expect(resolveCaptureMask({ maskInputs: undefined })).toEqual({
      inputs: true,
      selectors: []
    })
  })

  it('turns input masking off only for an explicit false', () => {
    expect(resolveCaptureMask({ maskInputs: false }).inputs).toBe(false)
  })

  it('trims selectors and drops blank ones', () => {
    expect(
      resolveCaptureMask({ maskSelectors: [' .a ', '', '  ', '#b'] }).selectors
    ).toEqual(['.a', '#b'])
  })
})

describe('the collector prelude', () => {
  it('declares the policy ahead of the source, as a function-scoped var', () => {
    const source = withCaptureMask('collector()', {
      inputs: false,
      selectors: ['.a']
    })
    expect(source).toBe(
      'var __wdioCaptureMask = {"inputs":false,"selectors":[".a"]};\ncollector()'
    )
  })

  it('is valid JavaScript whatever a selector contains', () => {
    const prelude = captureMaskPrelude({
      inputs: true,
      selectors: ['[data-x="</script>"]', "a[title='\\n']"]
    })
    const read = new Function(`${prelude} return __wdioCaptureMask`)()
    expect(read.selectors).toEqual(['[data-x="</script>"]', "a[title='\\n']"])
  })
})

describe('scrubTypedValues', () => {
  it('replaces each form a body or a log line carries the value in', () => {
    expect(typedValueForms('a b&c')).toEqual(['a b&c', 'a%20b%26c', 'a+b%26c'])
    expect(
      scrubTypedValues('raw=a b&c uri=a%20b%26c form=a+b%26c', ['a b&c'])
    ).toBe(`raw=${MASKED_VALUE} uri=${MASKED_VALUE} form=${MASKED_VALUE}`)
  })

  it('replaces the longer of two overlapping values first', () => {
    expect(scrubTypedValues('hunter2hunter', ['hunter', 'hunter2hunter'])).toBe(
      MASKED_VALUE
    )
  })

  it('leaves a value too short to tell apart from ordinary words', () => {
    expect(typedValueForms('tom')).toEqual([])
    expect(scrubTypedValues('bottom tom', ['tom'])).toBe('bottom tom')
  })
})
