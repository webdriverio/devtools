import { describe, expect, it } from 'vitest'

import {
  captureMaskPrelude,
  DEFAULT_CAPTURE_MASK,
  resolveCaptureMask,
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
