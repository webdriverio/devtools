// @vitest-environment happy-dom
import { afterEach, describe, expect, it, beforeEach } from 'vitest'
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
    // Still reached: hand-written WDIO tests use this syntax, and traces
    // recorded before the capture emitted XPath carry it in their a11y trees.
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

  describe('XPath locators — the form the capture emits for a text match', () => {
    const nativeEvaluate = document.evaluate

    afterEach(() => {
      document.evaluate = nativeEvaluate
    })

    /** happy-dom ships no XPath engine, so the engine is stubbed to assert what
     *  the resolver asks of it. Resolution against a real one is covered by the
     *  browser spec in `test-ui/workbench/player/snapshot.test.ts`. The
     *  double-cast is the stub satisfying only the one field the resolver reads
     *  out of the `XPathResult` it never constructs. */
    function stubXPath(result: Node | null): string[] {
      const asked: string[] = []
      document.evaluate = ((expression: string) => {
        asked.push(expression)
        return { singleNodeValue: result }
      }) as unknown as Document['evaluate']
      return asked
    }

    it('hands the expression to the document XPath engine verbatim', () => {
      const button = document.querySelector('button')
      const asked = stubXPath(button)

      expect(
        resolveTestSelector(document, '//button[contains(., "Login")]')
      ).toBe(button)
      expect(asked).toEqual(['//button[contains(., "Login")]'])
    })

    it('recognises every XPath shape a locator can arrive in', () => {
      const asked = stubXPath(document.querySelector('a'))

      for (const locator of [
        '//a[contains(., "Logout")]',
        '/html/body/a',
        './/a',
        '(//a[contains(., "Logout")])[1]'
      ]) {
        expect(resolveTestSelector(document, locator)).not.toBeNull()
      }
      expect(asked).toHaveLength(4)
    })

    it('draws nothing for a non-element result or a malformed expression', () => {
      stubXPath(document.createTextNode('Logout'))
      expect(resolveTestSelector(document, '//a/text()')).toBeNull()

      document.evaluate = (() => {
        throw new Error('Invalid expression')
      }) as unknown as Document['evaluate']
      expect(resolveTestSelector(document, '//a[contains(.,]')).toBeNull()
    })

    it('leaves CSS attribute selectors to querySelector', () => {
      // `[href="/logout"]` contains a slash but is not XPath — the shape test
      // must not steal it, since only querySelector can resolve it.
      stubXPath(null)

      expect(resolveTestSelector(document, 'a[href="/logout"]')?.tagName).toBe(
        'A'
      )
    })
  })

  it('does not treat an expected-text assertion arg as a selector', () => {
    // expect.toHaveText args carry the expected string, not a locator; without
    // a `tag=`/`*=` operator it must not match anything.
    expect(
      resolveTestSelector(document, 'You logged out of the secure area!')
    ).toBeNull()
  })
})
