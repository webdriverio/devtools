import { describe, expect, it } from 'vitest'

import { portableSha1Hex } from '../src/sha1-portable.js'
import { sha1Hex } from '../src/sha1.js'

describe('portableSha1Hex', () => {
  it.each([
    '',
    'abc',
    '/specs/login.ts',
    'C:\\Users\\ünïcødé\\😀.spec.ts',
    // Lengths either side of SHA-1's 55/56/64-byte padding boundaries.
    'a'.repeat(55),
    'a'.repeat(56),
    'a'.repeat(63),
    'a'.repeat(64),
    'a'.repeat(65),
    'x'.repeat(10_000)
  ])('matches node:crypto for %j', (text) => {
    expect(portableSha1Hex(text)).toBe(sha1Hex(text))
  })
})
