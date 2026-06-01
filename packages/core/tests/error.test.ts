import { describe, it, expect } from 'vitest'
import { toError, serializeError, errorMessage } from '../src/error.js'

describe('toError', () => {
  it('returns the input unchanged when it is already an Error', () => {
    const err = new Error('boom')
    expect(toError(err)).toBe(err)
  })

  it('preserves Error subclass instances', () => {
    const err = new TypeError('bad type')
    expect(toError(err)).toBe(err)
    expect(toError(err) instanceof TypeError).toBe(true)
  })

  it('wraps a plain object with a .message field into an Error preserving message + name', () => {
    const out = toError({ message: 'nightwatch failed', name: 'AssertionError' })
    expect(out).toBeInstanceOf(Error)
    expect(out.message).toBe('nightwatch failed')
    expect(out.name).toBe('AssertionError')
  })

  it('falls back to the default Error name when an object has no .name', () => {
    const out = toError({ message: 'oops' })
    expect(out.name).toBe('Error')
  })

  it('stringifies a thrown string', () => {
    expect(toError('something broke').message).toBe('something broke')
  })

  it('stringifies thrown numbers/null/undefined safely', () => {
    expect(toError(42).message).toBe('42')
    expect(toError(null).message).toBe('null')
    expect(toError(undefined).message).toBe('undefined')
  })

  it("ignores a non-string .name field on an object with .message", () => {
    const out = toError({ message: 'm', name: 123 as unknown as string })
    expect(out.name).toBe('Error')
  })
})

describe('errorMessage', () => {
  it('reads .message from an Error', () => {
    expect(errorMessage(new Error('boom'))).toBe('boom')
  })

  it('reads .message from Error subclasses', () => {
    expect(errorMessage(new TypeError('bad type'))).toBe('bad type')
  })

  it('returns a thrown string unchanged', () => {
    expect(errorMessage('something broke')).toBe('something broke')
  })

  it('reads .message from a plain object with one', () => {
    expect(errorMessage({ message: 'nightwatch failed' })).toBe(
      'nightwatch failed'
    )
  })

  it('returns "unknown error" for null/undefined', () => {
    expect(errorMessage(null)).toBe('unknown error')
    expect(errorMessage(undefined)).toBe('unknown error')
  })

  it('stringifies primitives that are neither Error nor string', () => {
    expect(errorMessage(42)).toBe('42')
    expect(errorMessage(true)).toBe('true')
  })

  it('falls back to String() for plain objects without .message', () => {
    expect(errorMessage({ foo: 'bar' })).toBe('[object Object]')
  })
})

describe('serializeError', () => {
  it('returns undefined for undefined input', () => {
    expect(serializeError(undefined)).toBeUndefined()
  })

  it('produces a JSON-safe shape with name/message/stack', () => {
    const err = new Error('boom')
    const out = serializeError(err)
    expect(out).toEqual({
      name: 'Error',
      message: 'boom',
      stack: err.stack
    })
  })

  it('preserves the subclass name', () => {
    const err = new TypeError('bad type')
    expect(serializeError(err)?.name).toBe('TypeError')
  })
})
