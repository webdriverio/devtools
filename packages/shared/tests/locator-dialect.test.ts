// Which locator the capture emits is decided per runner, because `a*=Logout`
// resolves in WebdriverIO alone while `//a[…]` resolves everywhere — and because
// XPath is free to reach in two of the three runners and not in the third. The
// exhaustive switch means a new TestRunnerId can't fall through silently, so each
// case is listed literally rather than looped over the table under test.

import { describe, it, expect } from 'vitest'
import {
  isXPathLocator,
  locatorDialect,
  locatorsMatch,
  xpathLocatorTag
} from '../src/locator-dialect.js'
import { TEST_RUNNER_IDS, isTestRunnerId } from '../src/types.js'

describe('locatorDialect grammar', () => {
  it('gives WebdriverIO its own text syntax', () => {
    // All three are WDIO runners — the framework, not the runner, owns the syntax.
    expect(locatorDialect('mocha').text).toBe('webdriverio')
    expect(locatorDialect('jasmine').text).toBe('webdriverio')
    expect(locatorDialect('cucumber').text).toBe('webdriverio')
  })

  it('gives XPath to the runners that have no text syntax', () => {
    expect(locatorDialect('nightwatch').text).toBe('xpath')
    expect(locatorDialect('nightwatch-cucumber').text).toBe('xpath')
    expect(locatorDialect('selenium-webdriver').text).toBe('xpath')
  })

  it('defaults an unidentified recorder to the portable form', () => {
    // A trace zip recorded before the runner was written into it, or by a
    // foreign tool: XPath is resolvable everywhere, so it is the safe answer.
    expect(locatorDialect(undefined).text).toBe('xpath')
  })

  it('answers for every runner id, so a new one cannot fall through', () => {
    for (const runner of TEST_RUNNER_IDS) {
      expect(['webdriverio', 'xpath']).toContain(locatorDialect(runner).text)
    }
  })
})

describe('locatorDialect branch order', () => {
  it('demotes the text branch for Nightwatch alone', () => {
    // The only runner reading a bare locator string under a default CSS
    // strategy, so the only one an XPath locator costs an extra call.
    expect(locatorDialect('nightwatch').textBranch).toBe('fallback')
    expect(locatorDialect('nightwatch-cucumber').textBranch).toBe('fallback')
  })

  it('keeps the text branch first where it is free', () => {
    // `button*=Login` is native to WDIO, and `By.xpath` is no more ceremony than
    // `By.css` — in both, the readable text form costs the user nothing.
    expect(locatorDialect('mocha').textBranch).toBe('first')
    expect(locatorDialect('jasmine').textBranch).toBe('first')
    expect(locatorDialect('cucumber').textBranch).toBe('first')
    expect(locatorDialect('selenium-webdriver').textBranch).toBe('first')
  })

  it('leaves an unidentified recorder on the portable default', () => {
    expect(locatorDialect(undefined).textBranch).toBe('first')
  })

  it('answers for every runner id, so a new one cannot fall through', () => {
    for (const runner of TEST_RUNNER_IDS) {
      expect(['first', 'fallback']).toContain(locatorDialect(runner).textBranch)
    }
  })
})

describe('locatorDialect xpath hint', () => {
  it('names what Nightwatch needs, which has no // auto-detection', () => {
    expect(locatorDialect('nightwatch').xpathHint).toBe(
      "useXpath() or locateStrategy: 'xpath'"
    )
    expect(locatorDialect('nightwatch-cucumber').xpathHint).toBe(
      "useXpath() or locateStrategy: 'xpath'"
    )
  })

  it('names By.xpath for Selenium', () => {
    expect(locatorDialect('selenium-webdriver').xpathHint).toBe('By.xpath()')
  })

  it('names nothing for WebdriverIO, which auto-detects the leading //', () => {
    expect(locatorDialect('mocha').xpathHint).toBeUndefined()
    expect(locatorDialect('jasmine').xpathHint).toBeUndefined()
    expect(locatorDialect('cucumber').xpathHint).toBeUndefined()
  })

  it('names nothing for an unidentified recorder rather than guessing', () => {
    expect(locatorDialect(undefined).xpathHint).toBeUndefined()
  })
})

describe('isTestRunnerId', () => {
  it('accepts every id in the table', () => {
    for (const runner of TEST_RUNNER_IDS) {
      expect(isTestRunnerId(runner)).toBe(true)
    }
  })

  it('rejects anything else a zip or a config might carry', () => {
    expect(isTestRunnerId('vitest')).toBe(false)
    expect(isTestRunnerId('Mocha')).toBe(false)
    expect(isTestRunnerId(undefined)).toBe(false)
    expect(isTestRunnerId(null)).toBe(false)
    expect(isTestRunnerId(1)).toBe(false)
  })
})

describe('isXPathLocator', () => {
  it('accepts every XPath shape a captured or hand-written locator takes', () => {
    expect(isXPathLocator('//a[contains(., "Logout")]')).toBe(true)
    expect(isXPathLocator('/html/body/a')).toBe(true)
    expect(isXPathLocator('./a')).toBe(true)
    expect(isXPathLocator('.//a')).toBe(true)
    expect(isXPathLocator('(//a[contains(., "Logout")])[2]')).toBe(true)
  })

  it('leaves every CSS form to querySelector', () => {
    // `[href="/logout"]` and `a.b\\/c` carry a slash but are CSS: claiming one
    // would route it to an engine that cannot resolve it.
    expect(isXPathLocator('#username')).toBe(false)
    expect(isXPathLocator('a[href="/logout"]')).toBe(false)
    expect(isXPathLocator('.flash')).toBe(false)
    expect(isXPathLocator('body > div:nth-of-type(2) > a')).toBe(false)
  })

  it('leaves the WebdriverIO text-selectors older traces carry to their parser', () => {
    expect(isXPathLocator('a*=Logout')).toBe(false)
    expect(isXPathLocator('button=Login')).toBe(false)
  })
})

describe('xpathLocatorTag', () => {
  it('reads the tag the capture scoped its text match to', () => {
    expect(xpathLocatorTag('//a[contains(., "Logout")]')).toBe('a')
    expect(xpathLocatorTag('//my-button[contains(., "Go")]')).toBe('my-button')
  })

  it('has no tag to report for CSS or a tag-less expression', () => {
    expect(xpathLocatorTag('//*[@text="Logout"]')).toBeUndefined()
    expect(xpathLocatorTag('#username')).toBeUndefined()
    expect(xpathLocatorTag('a*=Logout')).toBeUndefined()
  })
})

// The exporter matches a command's locator against the captured element records
// to stamp an input point. Once the capture emitted portable XPath, a `===` match
// stopped recognising a test that locates by WebdriverIO text syntax.
describe('locatorsMatch', () => {
  const captured = '//a[contains(., "Logout here")]'

  it('matches an identical locator', () => {
    expect(locatorsMatch('#username', '#username')).toBe(true)
    expect(locatorsMatch(captured, captured)).toBe(true)
  })

  it('matches a text locator against the XPath the capture emits for it', () => {
    expect(locatorsMatch(captured, 'a*=Logout')).toBe(true)
    expect(locatorsMatch(captured, '*=Logout')).toBe(true)
    expect(locatorsMatch(captured, 'a=Logout here')).toBe(true)
  })

  it('holds the tag and the text to account', () => {
    expect(locatorsMatch(captured, 'button*=Logout')).toBe(false)
    expect(locatorsMatch(captured, 'a*=Login')).toBe(false)
    // `=` is exact: the element's whole text is "Logout here", not "Logout".
    expect(locatorsMatch(captured, 'a=Logout')).toBe(false)
  })

  it('matches through either quote style the literal may use', () => {
    expect(locatorsMatch('//a[contains(., \'He said "go"\')]', 'a*=said')).toBe(
      true
    )
  })

  it('does not match unrelated CSS, or a concat()-stitched literal', () => {
    expect(locatorsMatch('#username', 'a*=Logout')).toBe(false)
    expect(locatorsMatch('a[href="/logout"]', 'a*=Logout')).toBe(false)
    expect(
      locatorsMatch('//a[contains(., concat("it\'s ", \'"x"\'))]', 'a*=x')
    ).toBe(false)
  })

  // The capture emits WebdriverIO's own syntax under WDIO now, so the two
  // dialects can appear on either side of the comparison.
  describe('with a WebdriverIO-dialect capture', () => {
    const wdioCapture = 'a*=Logout here'

    it('matches a test that wrote the same dialect', () => {
      expect(locatorsMatch(wdioCapture, 'a*=Logout')).toBe(true)
      expect(locatorsMatch(wdioCapture, '*=Logout')).toBe(true)
      expect(locatorsMatch(wdioCapture, 'a=Logout here')).toBe(true)
    })

    it('matches a test that wrote XPath instead', () => {
      expect(locatorsMatch(wdioCapture, '//a[contains(., "Logout")]')).toBe(
        true
      )
    })

    it('still holds the tag and the text to account', () => {
      expect(locatorsMatch(wdioCapture, 'button*=Logout')).toBe(false)
      expect(locatorsMatch(wdioCapture, 'a*=Login')).toBe(false)
      expect(locatorsMatch(wdioCapture, 'a=Logout')).toBe(false)
      expect(locatorsMatch(wdioCapture, '#username')).toBe(false)
    })
  })
})
