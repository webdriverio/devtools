import { describe, expect, it } from 'vitest'

import { callbackError } from '../src/helpers/callbackError.js'

describe('callbackError', () => {
  it('returns an Error result as it is', () => {
    const err = new Error('boom')
    expect(callbackError(err)).toBe(err)
  })

  // Regression: the W3C `value` wrapper was read first, so a failed protocol
  // action, whose value is null and whose Error sits beside it, read as a success.
  it('reads the Error a failed protocol action carries beside a null value', () => {
    const err = new Error(
      'Unable to navigate to url http://x/broken: net::ERR_FAILED'
    )
    expect(callbackError({ status: -1, value: null, error: err })).toBe(err)
  })

  it('reads a driver failure nested under the W3C value wrapper', () => {
    const found = callbackError({
      value: { error: 'no such element', message: 'no element #x' }
    })
    expect(found?.message).toBe('no element #x')
  })

  it('builds an Error from a string-shaped failure', () => {
    expect(
      callbackError({ error: 'went wrong', stack: 'at here' })
    ).toMatchObject({
      message: 'went wrong',
      stack: 'at here'
    })
  })

  it('ignores a success, an assertion result and a primitive', () => {
    expect(callbackError({ value: 'ok' })).toBeUndefined()
    expect(
      callbackError({ passed: false, message: 'expected x' })
    ).toBeUndefined()
    expect(callbackError('text')).toBeUndefined()
    expect(callbackError(null)).toBeUndefined()
  })

  it('stops descending after two wrappers', () => {
    const deep = { value: { value: { value: { error: 'buried' } } } }
    expect(callbackError(deep)).toBeUndefined()
  })
})
