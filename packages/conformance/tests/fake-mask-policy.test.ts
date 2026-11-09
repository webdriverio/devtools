import { describe, expect, it } from 'vitest'
import { MASKED_VALUE } from '@wdio/devtools-shared'

import { FakeMaskPolicy } from '../src/fake-mask-policy.js'

const OFF = 'var __wdioCaptureMask = {"inputs":false,"selectors":[]};\n'
const ON = 'var __wdioCaptureMask = {"inputs":true,"selectors":[]};\n'

describe('FakeMaskPolicy', () => {
  it('masks a password field by default and leaves any other field', () => {
    const mask = new FakeMaskPolicy()
    expect(mask.type('#password', 'secret')).toBe(MASKED_VALUE)
    expect(mask.type('#username', 'tom')).toBe('tom')
  })

  it('honours inputs:false declared in the script body or in a JSON-encoded argument', () => {
    const body = new FakeMaskPolicy()
    body.noteSource(`${OFF}collector`)
    expect(body.type('#password', 'secret')).toBe('secret')

    const arg = new FakeMaskPolicy()
    arg.noteSource('inject(arguments[0])', JSON.stringify([`${OFF}collector`]))
    expect(arg.type('#password', 'secret')).toBe('secret')
    expect(arg.undeclared).toBe(0)
  })

  it('counts a source that declares no policy', () => {
    const mask = new FakeMaskPolicy()
    mask.noteSource('collector')
    mask.noteSource(`${ON}collector`)
    expect(mask.undeclared).toBe(1)
  })
})
