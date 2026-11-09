import { describe, expect, it } from 'vitest'

import { documentBaseUrl } from '../src/document-base.js'

const PAGE = 'https://site.test/app/login'
const page = (...head: unknown[]) => ({
  type: 'html',
  props: {
    children: [
      { type: 'head', props: { children: head } },
      {
        type: 'body',
        props: { children: [{ type: 'base', props: { href: '/ignored/' } }] }
      }
    ]
  }
})
const base = (href: unknown) => ({ type: 'base', props: { href } })

describe('documentBaseUrl', () => {
  it('resolves the first <base href> against the document URL', () => {
    expect(documentBaseUrl(page(base('/css/'), base('/second/')), PAGE)).toBe(
      'https://site.test/css/'
    )
    expect(documentBaseUrl(page(base('http://cdn.test/a/')), PAGE)).toBe(
      'http://cdn.test/a/'
    )
  })

  it('falls back to the document URL without a base, and ignores one inside <body>', () => {
    expect(documentBaseUrl(page(), PAGE)).toBe(PAGE)
    expect(documentBaseUrl(page(base(42)), PAGE)).toBe(PAGE)
    expect(documentBaseUrl(undefined, PAGE)).toBe(PAGE)
  })

  it.each([
    'javascript:alert(1)',
    'data:text/html,<p>x</p>',
    'blob:https://site.test/1',
    'file:///etc/'
  ])('refuses a %s base and keeps the document URL', (href) => {
    expect(documentBaseUrl(page(base(href)), PAGE)).toBe(PAGE)
  })
})
