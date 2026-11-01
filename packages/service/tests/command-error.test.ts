import { describe, expect, it } from 'vitest'

import { serializeCommandError } from '../src/command-error.js'

const decorated = (message: string) =>
  Object.assign(new Error(message), { name: 'unknown error' })

describe('serializeCommandError', () => {
  // The Errors tab shows this text, and every other adapter shows the browser's own.
  it("strips webdriver's request context from a driver error", () => {
    const error = decorated(
      'WebDriverError: net::ERR_FAILED at /broken when running "http://127.0.0.1:4444/session/abc/url" with method "POST"'
    )
    expect(serializeCommandError(error)).toMatchObject({
      name: 'unknown error',
      message: 'net::ERR_FAILED at /broken'
    })
  })

  it('also when the decoration carries the command arguments', () => {
    const error = decorated(
      'WebDriverError: no such element: #x when running "http://127.0.0.1:4444/session/abc/element" with method "POST" and args {"using":"css selector","value":"#x"}'
    )
    expect(serializeCommandError(error)?.message).toBe('no such element: #x')
  })

  it('leaves any other message as it is', () => {
    expect(serializeCommandError(new Error('Timeout of 5000ms'))).toMatchObject(
      { name: 'Error', message: 'Timeout of 5000ms' }
    )
    expect(serializeCommandError(undefined)).toBeUndefined()
  })
})
