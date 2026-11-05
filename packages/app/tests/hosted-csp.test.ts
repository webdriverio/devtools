import { describe, expect, it } from 'vitest'

import { hostedPlayerCsp, playerCsp } from '@wdio/devtools-shared'

import { hostingHeaders } from '../hosting-headers.js'

// The replay iframe is same-origin, so it inherits this policy.
const policy = hostingHeaders()['Content-Security-Policy']!

const directive = (name: string): string[] =>
  policy
    .split(';')
    .map((part) => part.trim().split(/\s+/))
    .find(([key]) => key === name)!
    .slice(1)

describe('the hosted player CSP', () => {
  it('lets the replay base its relative URLs on the recorded site', () => {
    // snapshot.ts inserts <base href="<page url>">; refused, every relative
    // stylesheet resolves against the player and the page renders unstyled.
    expect(directive('base-uri')).toEqual(
      expect.arrayContaining(['https:', 'http:'])
    )
  })

  it('lets the replay load the recorded page’s styles, images and fonts', () => {
    expect(directive('style-src')).toEqual(
      expect.arrayContaining(['https:', "'unsafe-inline'"])
    )
    expect(directive('img-src')).toContain('*')
    expect(directive('font-src')).toContain('*')
  })

  it('keeps scripts on the player’s own origin', () => {
    expect(directive('script-src')).toEqual(["'self'"])
  })

  it('lets `?trace=` fetch a zip over https and nothing else', () => {
    expect(directive('connect-src')).toEqual(["'self'", 'https:'])
  })

  it('keeps the year-long asset cache off index.html and every other path', () => {
    expect(hostingHeaders()['Cache-Control']).toBeUndefined()
  })

  it('is the policy shared declares, so the two cannot drift', () => {
    expect(policy).toBe(hostedPlayerCsp())
  })

  it('differs from the local backend’s only in connect-src', () => {
    const local = playerCsp().split('; ')
    const hosted = policy.split('; ')
    expect(
      hosted.filter((part, i) => part !== local[i]).map((p) => p.split(' ')[0])
    ).toEqual(['connect-src'])
  })
})
