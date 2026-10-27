import { describe, expect, it } from 'vitest'
import { encodeInitialArgs, parseInitialArgs } from '../src/runner.js'

describe('initial args', () => {
  it('round-trips a selection, spaces and all', () => {
    const args = ['/abs/tests/my login.js', '--tag', 'smoke']
    expect(parseInitialArgs(encodeInitialArgs(args))).toEqual(args)
  })

  it('reads an absent, malformed or non-string-array value as no selection', () => {
    expect(parseInitialArgs(undefined)).toBeUndefined()
    expect(parseInitialArgs('')).toBeUndefined()
    expect(parseInitialArgs('{not json')).toBeUndefined()
    expect(parseInitialArgs('["a", 1]')).toBeUndefined()
    expect(parseInitialArgs('"a"')).toBeUndefined()
  })
})
