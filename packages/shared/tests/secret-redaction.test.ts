import { describe, expect, it } from 'vitest'

import { MIN_SECRET_LENGTH } from '../src/redaction-walk.js'
import {
  createSecretRedactor,
  REDACTED_SECRET,
  resolveSecrets,
  secretVariants
} from '../src/secret-redaction.js'
import { MASKED_VALUE } from '../src/input-mask.js'

const SECRET = 'SuperSecretPassword!'

describe('resolveSecrets', () => {
  it('ignores a value shorter than the minimum and never echoes it', () => {
    const { secrets, warnings } = resolveSecrets(['abc'], {})
    expect(MIN_SECRET_LENGTH).toBe(4)
    expect(secrets).toEqual([])
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).not.toContain('abc')
  })

  it('reads an env entry when it resolves, not later', () => {
    const env: Record<string, string> = { LOGIN: SECRET }
    const { secrets } = resolveSecrets([{ env: 'LOGIN' }], env)
    env.LOGIN = 'changed-later'
    expect(secrets).toEqual([SECRET])
  })
})

describe('secretVariants', () => {
  it('lists each encoded form once, longest first', () => {
    expect(secretVariants(SECRET)).toEqual([
      'SuperSecretPassword%21',
      'SuperSecretPassword!'
    ])
  })
})

describe('createSecretRedactor', () => {
  const redactor = createSecretRedactor([SECRET])!

  it('is absent when there is nothing to redact', () => {
    expect(createSecretRedactor([])).toBeUndefined()
  })

  it('uses the page mask placeholder', () => {
    expect(REDACTED_SECRET).toBe(MASKED_VALUE)
    expect(redactor.redactString(`pw=${SECRET}`)).toBe(`pw=${MASKED_VALUE}`)
  })

  it('returns the value itself when nothing in it changed', () => {
    const value = { args: ['#username', 'tomsmith'], nested: [{ a: 1 }] }
    expect(redactor.redact(value)).toBe(value)
  })

  it('copies rather than mutates what it changes', () => {
    const value = { args: ['#password', SECRET], other: { keep: 1 } }
    const out = redactor.redact(value)
    expect(out).toEqual({
      args: ['#password', MASKED_VALUE],
      other: { keep: 1 }
    })
    expect(value.args[1]).toBe(SECRET)
    expect(out.other).toBe(value.other)
  })

  it('keeps an Error an Error, with its message and stack redacted', () => {
    const err = new TypeError(`bad ${SECRET}`)
    const out = redactor.redact({ error: err }).error
    expect(out).toBeInstanceOf(TypeError)
    expect(out.message).toBe(`bad ${MASKED_VALUE}`)
    expect(out.stack).not.toContain(SECRET)
    expect(err.message).toContain(SECRET)
  })

  it('walks Maps and Sets, keeping their keys', () => {
    const map = new Map([[SECRET, { title: SECRET }]])
    const out = redactor.redact(map)
    expect([...out.keys()]).toEqual([SECRET])
    expect(out.get(SECRET)).toEqual({ title: MASKED_VALUE })
    expect([...redactor.redact(new Set([SECRET]))]).toEqual([MASKED_VALUE])
  })

  it('leaves binary data alone', () => {
    const bytes = Buffer.from(SECRET)
    expect(redactor.redact({ bytes }).bytes).toBe(bytes)
  })

  it('copies nothing when no value is known and only credentials are covered', () => {
    const credentials = createSecretRedactor([], { authHeaders: true })!
    const frame = {
      rows: Array.from({ length: 5_000 }, (_, i) => ({
        command: 'click',
        args: [`#el-${i}`],
        result: { nested: [i, `text ${i}`] }
      }))
    }
    expect(credentials.redact(frame)).toBe(frame)
  })

  it('copies only the containers on the path to a redacted header', () => {
    const credentials = createSecretRedactor([], { authHeaders: true })!
    const response = { status: 200 }
    const row = {
      requestHeaders: { Authorization: 'Bearer t0ken', Accept: '*/*' },
      response
    }
    const out = credentials.redact(row)
    expect(out.requestHeaders).toEqual({
      Authorization: MASKED_VALUE,
      Accept: '*/*'
    })
    expect(out.response).toBe(response)
  })

  it('keeps every prefix of a typed password, so a field kind, id, name, username or URL scheme survives', () => {
    const typed = createSecretRedactor([], {
      typed: ['password1', 'admin123', 'https://user:pw@example.test']
    })!
    const node = {
      type: 'input',
      props: {
        type: 'password',
        id: 'password',
        name: 'password',
        value: 'admin'
      },
      url: 'http'
    }
    expect(typed.redact(node)).toBe(node)
  })

  it('survives a cycle', () => {
    const value: Record<string, unknown> = { text: SECRET }
    value.self = value
    const out = redactor.redact(value)
    expect(out.text).toBe(MASKED_VALUE)
  })
})
