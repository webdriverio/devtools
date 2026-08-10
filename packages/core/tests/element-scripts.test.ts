// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'

import {
  accessibilityTreeScript,
  elementsScript
} from '../src/element-scripts.js'
import type {
  AccessibilityNode,
  BrowserElementInfo
} from '../src/element-types.js'
import { locatorsMatch } from '@wdio/devtools-shared'
import type { TestRunnerId } from '@wdio/devtools-shared'
import { accessibilityNodesToSnapshotNodes } from '../src/element-snapshot.js'

/** The scripts are injectable source, so they are run the way the adapters run
 *  them — `@wdio/elements` builds the same `new Function` wrapper. */
function run<T>(source: string): T[] {
  return new Function(`return ${source}`)() as T[]
}

function a11yNodes(html: string, runner?: TestRunnerId): AccessibilityNode[] {
  document.body.innerHTML = html
  return run<AccessibilityNode>(accessibilityTreeScript(false, runner))
}

function interactables(
  html: string,
  runner?: TestRunnerId
): BrowserElementInfo[] {
  document.body.innerHTML = html
  return run<BrowserElementInfo>(elementsScript(false, false, runner))
}

function locatorFor(
  nodes: (AccessibilityNode | BrowserElementInfo)[],
  name: string
): string {
  const node = nodes.find((n) => n.name === name)
  if (!node) {
    throw new Error(`no captured node named ${JSON.stringify(name)}`)
  }
  return node.selector
}

beforeEach(() => {
  // happy-dom has no layout engine, so the scripts' visibility gate would reject
  // every element and the walk would return nothing.
  Element.prototype.checkVisibility = () => true
})

describe('captured locators', () => {
  it('emits portable XPath for a uniquely text-matched element', () => {
    const nodes = a11yNodes('<a href="/logout"><i></i> Logout</a>')

    expect(locatorFor(nodes, 'Logout')).toBe('//a[contains(., "Logout")]')
  })

  it('emits no WebdriverIO text-selector syntax for any node', () => {
    const nodes = a11yNodes(`
      <h2>Login Page</h2>
      <form>
        <input id="username" name="username" placeholder="Username">
        <button type="submit">Login</button>
      </form>
      <a href="/logout"><i></i> Logout</a>
    `)

    expect(nodes.length).toBeGreaterThan(0)
    for (const node of nodes) {
      expect(node.selector).not.toContain('*=')
    }
  })

  it('emits the runner-native text form for a WebdriverIO run', () => {
    // `//a[…]` needs `useXpath()` in Nightwatch and `By.xpath` in Selenium, but
    // a WDIO user pastes `a*=Logout` straight into `$()`.
    const nodes = a11yNodes('<a href="/logout"><i></i> Logout</a>', 'mocha')

    expect(locatorFor(nodes, 'Logout')).toBe('a*=Logout')
  })

  it('emits XPath for the runners with no text form of their own', () => {
    const html = '<a href="/logout"><i></i> Logout</a>'

    for (const runner of ['nightwatch', 'selenium-webdriver'] as const) {
      expect(locatorFor(a11yNodes(html, runner), 'Logout')).toBe(
        '//a[contains(., "Logout")]'
      )
    }
  })

  it('keeps XPath under WebdriverIO when the text carries a double quote', () => {
    // WDIO compiles `tag*=text` into XPath with `"` quoting, so a text carrying
    // one would produce a broken expression. WDIO resolves `//` itself.
    const nodes = a11yNodes('<p>He said "hello" loudly</p>', 'mocha')

    expect(locatorFor(nodes, 'He said "hello" loudly')).toBe(
      '//p[contains(., \'He said "hello" loudly\')]'
    )
  })

  it('emits the same CSS branches for every runner — only their order varies', () => {
    // Every element here shares its text with a same-tag sibling, so the text
    // branch is unreachable in both orders and the two runners have to agree.
    const html = `
      <button aria-label="close">dismiss</button>
      <button data-testid="save">dismiss</button>
      <input id="username" name="username" placeholder="Username">
      <input name="password" type="password">
      <div role="button" class="pick-me">dismiss</div>
      <div role="button">dismiss</div>
    `

    expect(a11yNodes(html, 'mocha').map((n) => n.selector)).toEqual(
      a11yNodes(html, 'nightwatch').map((n) => n.selector)
    )
  })

  it('keeps the tag scope, so the locator cannot match a different element type', () => {
    const nodes = a11yNodes(
      '<button type="submit">Login</button><a href="/login">Login</a>'
    )

    expect(locatorFor(nodes, 'Login')).toBe('//button[contains(., "Login")]')
  })

  it('falls through to CSS when the text is not unique for the tag', () => {
    // The ancestor div contains the inner text too, so neither the DOM count
    // nor XPath's `contains(., …)` would resolve to one element.
    const nodes = a11yNodes(
      '<div role="button">outer <div role="button">inner</div></div>'
    )

    expect(locatorFor(nodes, 'inner')).toBe('body > div > div')
  })

  it('leaves the CSS fallback branches untouched', () => {
    // Every element here shares its text with a same-tag sibling, which is what
    // pushes each past the text branch onto the branch under test.
    const nodes = a11yNodes(`
      <button aria-label="close">dismiss</button>
      <button data-testid="save">dismiss</button>
      <input id="username" name="username" placeholder="Username">
      <input name="password" type="password">
      <textarea name="comment"></textarea>
      <div role="button" class="pick-me">dismiss</div>
      <div role="button">dismiss</div>
    `)
    const locators = nodes.map((node) => node.selector)

    expect(locatorFor(nodes, 'close')).toBe('[aria-label="close"]')
    expect(locatorFor(nodes, 'Username')).toBe('#username')
    expect(locators).toContain('[data-testid="save"]')
    expect(locators).toContain('input[name="password"]')
    expect(locators).toContain('textarea[name="comment"]')
    expect(locators).toContain('div.pick-me')
  })

  it('skips a duplicated id, like every other CSS branch skips a non-unique match', () => {
    // An id is only a locator while it is unique. Duplicate ids are invalid HTML
    // but common in real pages, and `#dup` there resolves to whichever element
    // the DOM happens to return first.
    const nodes = a11yNodes(
      `<button id="dup" type="submit">Alpha</button>
       <button id="dup" type="reset">Beta</button>`,
      'nightwatch'
    )

    expect(locatorFor(nodes, 'Alpha')).toBe('button[type="submit"]')
    expect(locatorFor(nodes, 'Beta')).toBe('button[type="reset"]')
  })

  it('lets the text branch have its turn when a duplicated id is all the CSS branches had', () => {
    // Nightwatch orders CSS first, so an unconditional `#id` consumed the
    // element before the text branch — the one branch that could still identify
    // it — was ever reached.
    const nodes = a11yNodes(
      `<div role="button" id="dup">Alpha</div>
       <div role="button" id="dup">Beta</div>`,
      'nightwatch'
    )

    expect(locatorFor(nodes, 'Alpha')).toBe('//div[contains(., "Alpha")]')
  })

  it('prefers a native CSS locator to XPath for Nightwatch', () => {
    // The one runner that reads a bare locator string under a default CSS
    // strategy: `//button[…]` there needs useXpath(), `button[type="submit"]`
    // needs nothing.
    const nodes = a11yNodes(
      '<button class="radius" type="submit">Login</button>',
      'nightwatch'
    )

    expect(locatorFor(nodes, 'Login')).toBe('button[type="submit"]')
  })

  it('keeps text first for the runners it costs nothing', () => {
    // WDIO resolves `button*=Login` natively; Selenium wraps every locator in a
    // `By.…` anyway, so `By.xpath` asks no more than `By.css`.
    const html = '<button class="radius" type="submit">Login</button>'

    expect(locatorFor(a11yNodes(html, 'mocha'), 'Login')).toBe('button*=Login')
    expect(locatorFor(a11yNodes(html, 'selenium-webdriver'), 'Login')).toBe(
      '//button[contains(., "Login")]'
    )
    expect(locatorFor(a11yNodes(html), 'Login')).toBe(
      '//button[contains(., "Login")]'
    )
  })

  it('falls back to text for Nightwatch when no unique CSS locator exists', () => {
    // Nothing on the link is unique but its own text, so the demoted branch is
    // still reached — ahead of the meaningless positional path.
    const nodes = a11yNodes(
      '<a href="/logout"><i></i> Logout</a>',
      'nightwatch'
    )

    expect(locatorFor(nodes, 'Logout')).toBe('//a[contains(., "Logout")]')
  })

  it('prefers text to the positional path for Nightwatch', () => {
    const nodes = a11yNodes(
      '<div role="button">alpha</div><div role="button">beta</div>',
      'nightwatch'
    )

    expect(locatorFor(nodes, 'alpha')).toBe('//div[contains(., "alpha")]')
  })

  it('generates one grammar for both injected scripts', () => {
    const html = '<a href="/logout"><i></i> Logout</a>'

    expect(locatorFor(interactables(html), 'Logout')).toBe(
      locatorFor(a11yNodes(html), 'Logout')
    )
  })

  it('generates one grammar for both scripts under each runner', () => {
    // `-snapshot.txt` comes from one script and `-elements.json` from the other;
    // a per-runner branch in only one would desync the two artifacts.
    const html = '<a href="/logout"><i></i> Logout</a>'

    for (const runner of ['mocha', 'nightwatch'] as const) {
      expect(locatorFor(interactables(html, runner), 'Logout')).toBe(
        locatorFor(a11yNodes(html, runner), 'Logout')
      )
    }
  })
})

// `type` is what a form control is usually written by (`button[type="submit"]`,
// `input[type="email"]`) and it is the only semantic attribute a control that
// carries no id, name or test id tends to have.
describe('the type-attribute branch', () => {
  it('identifies a control by its type when that is unique', () => {
    const nodes = a11yNodes(
      `<input type="text" class="first" placeholder="First">
       <input type="email" class="third" placeholder="Email">`,
      'nightwatch'
    )

    expect(locatorFor(nodes, 'Email')).toBe('input[type="email"]')
  })

  it('skips it when the type does not single the control out', () => {
    const nodes = a11yNodes(
      `<input type="text" class="first" placeholder="First">
       <input type="text" class="second" placeholder="Second">`,
      'nightwatch'
    )

    expect(locatorFor(nodes, 'First')).toBe('input.first')
  })

  it('yields to the branches that identify the element more strongly', () => {
    const nodes = a11yNodes(
      `<button id="go" type="submit">Go</button>
       <input name="q" type="search" placeholder="Query">
       <input type="checkbox" data-testid="agree" aria-label="Agree">`,
      'nightwatch'
    )
    const locators = nodes.map((node) => node.selector)

    expect(locatorFor(nodes, 'Go')).toBe('#go')
    expect(locatorFor(nodes, 'Query')).toBe('input[name="q"]')
    expect(locatorFor(nodes, 'Agree')).toBe('[aria-label="Agree"]')
    expect(locators).not.toContain('input[type="checkbox"]')
  })
})

describe('XPath string literals', () => {
  it('wraps text carrying a double quote in single quotes', () => {
    const nodes = a11yNodes('<p>He said "hello" loudly</p>')

    expect(locatorFor(nodes, 'He said "hello" loudly')).toBe(
      '//p[contains(., \'He said "hello" loudly\')]'
    )
  })

  it('keeps double quotes for text carrying only a single quote', () => {
    const nodes = a11yNodes("<p>It's fine</p>")

    expect(locatorFor(nodes, "It's fine")).toBe(
      '//p[contains(., "It\'s fine")]'
    )
  })

  it('stitches text carrying both quote kinds with concat', () => {
    // XPath 1.0 has no string escape, so this is the only expressible form.
    const nodes = a11yNodes('<p>It\'s a "quoted" mess</p>')

    expect(locatorFor(nodes, 'It\'s a "quoted" mess')).toBe(
      '//p[contains(., concat("It\'s a ", \'"\', "quoted", \'"\', " mess"))]'
    )
  })

  it('emits a bare literal rather than a one-argument concat', () => {
    // `concat()` takes at least two arguments, so a value that is nothing but
    // double quotes must not be wrapped in one.
    const nodes = a11yNodes('<p>"</p><span>x</span>')

    expect(locatorFor(nodes, '"')).toBe("//p[contains(., '\"')]")
  })
})

// The grammar is emitted here as a string and parsed in shared by regex. Feeding
// a REAL generated locator through the parser is what keeps the two from
// drifting — a producer tweak that the regex can't read would otherwise only
// show up as a silently missing input point in an exported trace.
describe('generated locators the exporter has to parse back', () => {
  const html = '<a href="/logout"><i></i> Logout</a>'

  it('matches the test-written form it was generated from, in either dialect', () => {
    for (const runner of [
      'mocha',
      'nightwatch',
      'selenium-webdriver'
    ] as const) {
      const captured = locatorFor(a11yNodes(html, runner), 'Logout')

      expect(locatorsMatch(captured, 'a*=Logout')).toBe(true)
      expect(locatorsMatch(captured, '//a[contains(., "Logout")]')).toBe(true)
      expect(locatorsMatch(captured, 'button*=Logout')).toBe(false)
    }
  })

  it('yields its tag to the snapshot serializer in either dialect', () => {
    // The serializer reads the tag back out of the locator it was handed, so a
    // dialect it can't parse would report the ARIA role as the tag instead.
    for (const runner of ['mocha', 'nightwatch'] as const) {
      const nodes = accessibilityNodesToSnapshotNodes(a11yNodes(html, runner), {
        inViewportOnly: false
      })
      const link = nodes.find((n) => n.name === 'Logout')

      expect(link?.tagName).toBe('a')
    }
  })
})
