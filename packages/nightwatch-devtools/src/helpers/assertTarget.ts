// Which element a Nightwatch row is about — for a native `browser.assert.*` /
// `browser.verify.*` row, and for a driver command whose result an assertion may
// later be made on.
//
// Nightwatch names the target in the CALL: every element assertion in
// `lib/api/assertions/*.js` takes the element definition as its FIRST argument
// (`textContains(definition, expected)`), while the page-level ones take the
// expected value there instead (`urlContains(expected)`). Element commands
// follow the same shape (`getText(definition, callback)`), so both answers come
// off arg 0 — under a per-kind allowlist, because the same namespaces also carry
// calls whose arg 0 is a plain value or a url.
//
// node:assert is the case this can't answer: it takes VALUES and names no
// element, so `commandTargetSelector` feeds core's value→locator registry from
// the command path and the assert row reads its target back from there.
//
// Neither allowlist is derivable from shared's `ACTION_MAP`: that table says how
// a command RENDERS (its `Element` entries include WDIO commands called on a
// handle, with no selector argument at all), not whether arg 0 is a definition.

/**
 * Assertions whose first argument is an element definition, transcribed from
 * Nightwatch's own assertion signatures. An allowlist, not a heuristic: the same
 * namespace also carries the page-level assertions (`titleContains`,
 * `urlContains`) and node:assert's value-based mirrors (`ok`, `equal`, …), whose
 * first argument is a plain value — attaching it as a locator is how a
 * page-title assertion ends up boxing an unrelated element.
 */
const ELEMENT_TARGET_ASSERTIONS: ReadonlySet<string> = new Set([
  'attributeContains',
  'attributeEquals',
  'attributeMatches',
  'containsText',
  'cssClassNotPresent',
  'cssClassPresent',
  'cssProperty',
  'domPropertyContains',
  'domPropertyEquals',
  'domPropertyMatches',
  'elementNotPresent',
  'elementPresent',
  'elementsCount',
  'enabled',
  'hasAttribute',
  'hasClass',
  'hasDescendants',
  'hidden',
  'selected',
  'textContains',
  'textEquals',
  'textMatches',
  'value',
  'valueContains',
  'valueEquals',
  'visible'
])

/**
 * Commands whose RESULT is a read of the element named by their first argument,
 * transcribed from Nightwatch's element-command signatures. An allowlist for the
 * same reason as above: `browser.url('https://…')` takes a string first too, and
 * reading it as a locator would attribute the page's own reads to an element.
 * Everything absent — every driver-level read included — records its value as
 * belonging to no element (core's `rememberReadValue` sentinel).
 */
const ELEMENT_READ_COMMANDS: ReadonlySet<string> = new Set([
  'getAccessibleName',
  'getAriaRole',
  'getAttribute',
  'getCssProperty',
  'getElementProperty',
  'getElementSize',
  'getLocation',
  'getLocationInView',
  'getRect',
  'getTagName',
  'getText',
  'getValue',
  'isEnabled',
  'isPresent',
  'isSelected',
  'isVisible',
  'waitForElementNotPresent',
  'waitForElementNotVisible',
  'waitForElementPresent',
  'waitForElementVisible'
])

/**
 * Element commands that ACT on the element named by their first argument.
 * Deliberately a second set rather than an extension of the reads above: that
 * one also decides which results enter the value→locator registry, and a click's
 * result is not a value any assertion can be made about. Same allowlist
 * discipline — `browser.keys('abc')` takes a string first too.
 */
const ELEMENT_ACTION_COMMANDS: ReadonlySet<string> = new Set([
  'clearValue',
  'click',
  'doubleClick',
  'moveToElement',
  'rightClick',
  'setValue',
  'submitForm',
  'updateValue'
])

/** `assert.not.visible('#x')` is recorded under the dotted path `not.visible`;
 *  negating an assertion doesn't change which argument is the element. */
function baseMethod(method: string): string {
  return method.startsWith('not.') ? method.slice('not.'.length) : method
}

/**
 * The selector an element definition carries: a raw string, or the `selector`
 * property of a `{selector, locateStrategy}` bag / a Nightwatch `Element`
 * (duck-typed, so no dependency on Nightwatch's class identity). A definition
 * built from an already-resolved handle carries no selector at all — such a row
 * gets none rather than a wrong one.
 */
function definitionSelector(definition: unknown): string | undefined {
  if (typeof definition === 'string') {
    return definition || undefined
  }
  if (definition && typeof definition === 'object') {
    const selector = (definition as { selector?: unknown }).selector
    if (typeof selector === 'string' && selector) {
      return selector
    }
  }
  return undefined
}

/** Locator of the element a native assertion was about, or undefined when the
 *  assertion targets no element (page title, url, a value comparison). Lands on
 *  `CommandLog.selector` so the player's overlay boxes the target the way it
 *  does for WDIO's folded matcher rows. */
export function assertTargetSelector(
  method: string,
  args: unknown[]
): string | undefined {
  if (!ELEMENT_TARGET_ASSERTIONS.has(baseMethod(method))) {
    return undefined
  }
  return definitionSelector(args[0])
}

/** Locator a driver-command row is about — the element it read or acted on.
 *  Lands on `CommandLog.selector` so the row says what it targeted instead of
 *  leaving the exporter to fall back to `args[0]`. Wider than
 *  {@link commandTargetSelector}, which answers the narrower provenance question
 *  (whose read produced this value) for the value→locator registry. */
export function commandRowSelector(
  method: string,
  args: unknown[]
): string | undefined {
  if (
    !ELEMENT_READ_COMMANDS.has(method) &&
    !ELEMENT_ACTION_COMMANDS.has(method)
  ) {
    return undefined
  }
  return definitionSelector(args[0])
}

/** Locator of the element a driver command read from, or undefined when the
 *  command reads the page rather than an element. Feeds core's value→locator
 *  registry: `undefined` records the result as belonging to no element, which is
 *  the sentinel a later node:assert on a page-level value relies on. */
export function commandTargetSelector(
  method: string,
  args: unknown[]
): string | undefined {
  if (!ELEMENT_READ_COMMANDS.has(method)) {
    return undefined
  }
  return definitionSelector(args[0])
}
