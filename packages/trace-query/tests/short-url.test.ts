import { describe, expect, it } from 'vitest'
import type { NetworkRequest } from '@wdio/devtools-shared'
import { mainOrigin, withoutOrigin } from '../src/short-url.js'

const ORIGIN = 'http://127.0.0.1:4567'

describe('withoutOrigin', () => {
  it.each([
    [`${ORIGIN}/login?next=1#top`, '/login?next=1#top'],
    [`${ORIGIN}/`, '/'],
    [`${ORIGIN}?q=1`, '/?q=1'],
    [`${ORIGIN}#top`, '/#top']
  ])('drops the main origin from %s', (url, short) => {
    expect(withoutOrigin(url, ORIGIN)).toBe(short)
  })

  it.each([
    { what: 'credentials', url: 'http://u:p@127.0.0.1:4567/x' },
    { what: 'a blob URL', url: `blob:${ORIGIN}/0b6a2c1e-uuid` },
    { what: 'a longer port', url: 'http://127.0.0.1:45678/x' },
    { what: 'the bare origin', url: ORIGIN },
    { what: 'another origin', url: 'https://cdn.example.com/app.js' },
    { what: 'a data URL', url: 'data:text/plain,hello' }
  ])('keeps a URL with $what whole', ({ url }) => {
    expect(withoutOrigin(url, ORIGIN)).toBe(url)
  })

  it('keeps a URL that names the default port explicitly whole', () => {
    const url = 'http://example.com:80/x'
    expect(withoutOrigin(url, 'http://example.com')).toBe(url)
  })

  it('keeps a URL with an internationalized host whole', () => {
    const url = 'http://bücher.example/x'
    expect(new URL(url).origin).toBe('http://xn--bcher-kva.example')
    expect(withoutOrigin(url, 'http://xn--bcher-kva.example')).toBe(url)
  })

  it('keeps every URL whole when there is no main origin', () => {
    expect(withoutOrigin(`${ORIGIN}/x`, undefined)).toBe(`${ORIGIN}/x`)
  })
})

describe('mainOrigin', () => {
  const row = (url: string, type: NetworkRequest['type']): NetworkRequest => ({
    id: url,
    url,
    method: 'GET',
    type,
    timestamp: 0,
    startTime: 0
  })

  it('takes the first document’s origin over the most frequent one', () => {
    expect(
      mainOrigin([
        row('https://cdn.example.com/a.js', 'script'),
        row('https://cdn.example.com/b.js', 'script'),
        row('https://cdn.example.com/c.css', 'stylesheet'),
        row(`${ORIGIN}/login`, 'document')
      ])
    ).toBe(ORIGIN)
  })

  it('takes the most frequent origin when no document names one', () => {
    expect(
      mainOrigin([
        row(`${ORIGIN}/api/a`, 'fetch'),
        row('https://cdn.example.com/a.js', 'script'),
        row('https://cdn.example.com/b.js', 'script'),
        row('data:text/plain,x', 'document')
      ])
    ).toBe('https://cdn.example.com')
  })

  it('names none when no request has one', () => {
    expect(mainOrigin([row('data:text/plain,x', 'other')])).toBeUndefined()
  })
})
