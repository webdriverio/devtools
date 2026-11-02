// Which locator each runner is best handed: the grammar its text form is
// written in, where that text form sits in the capture's branch order, and what
// it needs told when the grammar is XPath. The one fact table behind both sides
// — the page capture reads it to decide what to emit, the player reads it to
// caption what it hands the user.
//
// WebdriverIO has its own `tag*=text` form and auto-detects a leading `//`;
// Selenium and Nightwatch have no text form, and neither auto-detects XPath —
// Selenium takes it via `By.xpath`, Nightwatch via its `'xpath'` strategy.

import type { TestRunnerId } from './types.js'

/** Text-locator grammar a runner resolves natively. Only the capture's text
 *  branch varies by it; every other branch is portable CSS. */
export type TextLocatorDialect = 'webdriverio' | 'xpath'

/** Where the text branch sits among the capture's branches. `first` prefers the
 *  readable text form; `fallback` reaches it only when no unique CSS locator
 *  exists, still ahead of the meaningless positional path. */
export type TextBranchOrder = 'first' | 'fallback'

export interface LocatorDialect {
  text: TextLocatorDialect
  textBranch: TextBranchOrder
  /** The call that makes the runner treat a captured XPath locator as XPath.
   *  Undefined where naming one would be wrong (WebdriverIO needs none) or a
   *  guess (an unidentified recorder). */
  xpathHint?: string
}

/** An unidentified recorder gets XPath text first: it is the portable form and
 *  the readable one, so it is the safe answer rather than a guess. */
export function locatorDialect(
  runner: TestRunnerId | undefined
): LocatorDialect {
  switch (runner) {
    case 'mocha':
    case 'jasmine':
    case 'cucumber':
      return { text: 'webdriverio', textBranch: 'first' }
    // Every Selenium locator is wrapped in a `By.…`, so `By.xpath` asks no more
    // of the user than `By.css` — the text form stays first.
    case 'selenium-webdriver':
      return { text: 'xpath', textBranch: 'first', xpathHint: 'By.xpath()' }
    // The only runner where a bare locator string is read under a default CSS
    // strategy, so it is the only one where XPath costs the user something.
    case 'nightwatch':
    case 'nightwatch-cucumber':
      return {
        text: 'xpath',
        textBranch: 'fallback',
        xpathHint: "useXpath() or locateStrategy: 'xpath'"
      }
    case undefined:
      return { text: 'xpath', textBranch: 'first' }
  }
}

/** A captured locator is portable CSS, or XPath where the element's own text
 *  identifies it */
export function isXPathLocator(locator: string): boolean {
  // No CSS selector can open with `/` or `(`, so this never claims one that
  // querySelector could have parsed. Covers `//a[…]`, `/html/…`, `./a`, `.//a`
  // and the indexed `(//a[…])[2]`.
  return /^\(*\.{0,2}\//.test(locator)
}

/** Tag name an XPath locator is scoped to, for a consumer that reports the tag
 *  it matched. Undefined for CSS and for a tag-less expression (`//*[…]`). */
export function xpathLocatorTag(locator: string): string | undefined {
  return /^\/\/([a-z][a-z0-9-]*)\[/.exec(locator)?.[1]
}

/** WebdriverIO's text-locator forms — `tag*=Contains`, `tag=Exact`, tag optional. */
const TEXT_LOCATOR_RE = /^([a-z][a-z0-9-]*)?(\*?)=(.+)$/i

/** A text locator in either dialect, decomposed. `tag` is `*` when the form
 *  names none; `partial` marks a contains-match rather than an exact one.
 *  Undefined for every non-text locator, including the `concat()`-stitched
 *  literal that text carrying both quote kinds produces — that one is left to
 *  exact comparison rather than parsed back. */
function textLocatorParts(
  locator: string
): { tag: string; text: string; partial: boolean } | undefined {
  const xpath =
    /^\/\/([a-z][a-z0-9-]*|\*)\[contains\(\.,\s*(["'])(.*)\2\)\]$/i.exec(
      locator
    )
  if (xpath) {
    return { tag: xpath[1]!.toLowerCase(), text: xpath[3]!, partial: true }
  }
  const wdio = TEXT_LOCATOR_RE.exec(locator)
  if (!wdio) {
    return undefined
  }
  return {
    tag: wdio[1]?.toLowerCase() ?? '*',
    text: wdio[3]!,
    partial: wdio[2] === '*'
  }
}

/** Whether a locator the page capture generated and one a test wrote denote the
 *  same element. Both sides are decomposed from either dialect, because which of
 *  the two the capture emits depends on the runner while what a test writes does
 *  not — a `===` drops the input point whenever they differ. */
export function locatorsMatch(captured: string, written: string): boolean {
  if (captured === written) {
    return true
  }
  const target = textLocatorParts(captured)
  const test = textLocatorParts(written)
  if (!target || !test) {
    return false
  }
  if (target.tag !== '*' && test.tag !== '*' && target.tag !== test.tag) {
    return false
  }
  // The capture stores the element's whole trimmed text, so a contains-match has
  // to be a substring of it while an exact one names it in full.
  return test.partial
    ? target.text.includes(test.text)
    : target.text === test.text
}
