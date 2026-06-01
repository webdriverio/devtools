import { describe, it, expect } from 'vitest'
import { toError, serializeError } from '../src/error.js'

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
