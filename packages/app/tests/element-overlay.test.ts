// @vitest-environment happy-dom
import { describe, expect, it, beforeEach } from 'vitest'
import { resolveTestSelector } from '../src/components/browser/element-overlay.js'

describe('resolveTestSelector', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <form>
        <input id="username" />
        <button type="submit">Login</button>
      </form>
      <a href="/logout"><i></i> Logout</a>
      <div id="flash">You logged out of the secure area! ×</div>
      <p>Login attempts remaining</p>
    `
  })

  it('resolves plain CSS selectors', () => {
    expect(resolveTestSelector(document, '#username')?.id).toBe('username')
    expect(resolveTestSelector(document, '#flash')?.id).toBe('flash')
  })

  it('resolves WDIO contains-text selectors querySelector cannot parse', () => {
    // The exact locators from the failing trace.
    expect(resolveTestSelector(document, 'button*=Login')?.tagName).toBe(
      'BUTTON'
    )
    const logout = resolveTestSelector(document, 'a*=Logout')
    expect(logout?.tagName).toBe('A')
    expect(logout?.getAttribute('href')).toBe('/logout')
  })

  it('resolves exact-text selectors and tag-less forms', () => {
    expect(resolveTestSelector(document, 'button=Login')?.tagName).toBe(
      'BUTTON'
    )
    // `*=` with no tag → deepest element containing the text, not <body>.
    expect(resolveTestSelector(document, '*=Login attempts')?.tagName).toBe('P')
  })

  it('returns null when the locator is absent on the page', () => {
    expect(resolveTestSelector(document, '#missing')).toBeNull()
    expect(resolveTestSelector(document, 'button*=Register')).toBeNull()
  })

  it('does not treat an expected-text assertion arg as a selector', () => {
    // expect.toHaveText args carry the expected string, not a locator; without
    // a `tag=`/`*=` operator it must not match anything.
    expect(
      resolveTestSelector(document, 'You logged out of the secure area!')
    ).toBeNull()
  })
})
