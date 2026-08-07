// Recovers the locator an element command acted through: Selenium consumes it at
// `findElement` time and hands back an opaque handle, so the command itself sees
// only the handle. The row carries the result as `CommandLog.selector`.
//
// Two registries, both answering "which locator does this belong to": one keyed
// on the element handle (for a command acting THROUGH an element), one on the
// value a read resolved to (for an assertion acting on that value — a Selenium
// test asserts `assert.equal(text, …)`, never against the element itself, so the
// value is the only link back to the locator).

/** `By.id('x')` compiles to this CSS form. */
const BY_ID_CSS_RE = /^\*\[id="([\w-]+)"\]$/

// Keyed by handle identity rather than element id: `WebElement.id_` is a promise
// in every supported version, so no id is readable when a command is invoked. A
// WeakMap also bounds itself — a dropped or stale handle is collected, not pinned
// for the length of the run.
const locatorsByElement = new WeakMap<object, string>()

const BY_USING_TO_SELECTOR: Record<string, (value: string) => string> = {
  'css selector': canonicalizeCss,
  xpath: (value) => value,
  'tag name': (value) => value
}

// A shorthand hash (`findElement({ id: 'x' })`) goes through the matching `By`
// factory, so mirror what each one compiles to.
const BY_HASH_TO_SELECTOR: Record<string, (value: string) => string> = {
  css: (value) => value,
  id: (value) => `#${value}`,
  name: (value) => `[name="${value}"]`,
  className: (value) => `.${value.trim().split(/\s+/).join('.')}`,
  tagName: (value) => value,
  xpath: (value) => value
}

function canonicalizeCss(value: string): string {
  // `#x` is the form the captured element records carry, and the input point
  // matches those records by exact string.
  const byId = BY_ID_CSS_RE.exec(value)
  return byId ? `#${byId[1]}` : value
}

/** A `By`, a `{using, value}` pair, a shorthand hash or a raw string, as the
 *  selector string the rest of the system speaks. Undefined for locators with no
 *  selector equivalent (link text, a JS or relative locator). */
export function locatorToSelector(locator: unknown): string | undefined {
  if (typeof locator === 'string') {
    return locator || undefined
  }
  if (!locator || typeof locator !== 'object') {
    return undefined
  }
  const by = locator as { using?: unknown; value?: unknown }
  if (typeof by.using === 'string' && typeof by.value === 'string') {
    return BY_USING_TO_SELECTOR[by.using]?.(by.value)
  }
  for (const [key, toSelector] of Object.entries(BY_HASH_TO_SELECTOR)) {
    const value = (locator as Record<string, unknown>)[key]
    if (typeof value === 'string' && value) {
      return toSelector(value)
    }
  }
  return undefined
}

/** Attribute a locator to the element handle(s) it produced. Called for both of
 *  the objects one find yields — the promise it returns and the element that
 *  promise resolves to — because either can be the receiver of a command. */
export function rememberElementLocator(
  target: unknown,
  locator: unknown
): void {
  const selector = locatorToSelector(locator)
  if (!selector) {
    return
  }
  for (const el of Array.isArray(target) ? target : [target]) {
    if (el && typeof el === 'object') {
      locatorsByElement.set(el as object, selector)
    }
  }
}

/** The locator that produced this element handle, if we saw the find. */
export function selectorForElement(el: unknown): string | undefined {
  return el && typeof el === 'object'
    ? locatorsByElement.get(el as object)
    : undefined
}

/** Bounds the read-value registry. A run reads far more values than any
 *  assertion looks back over, and only the recent ones can be an assert's
 *  subject. */
const MAX_READ_VALUES = 200

/** Values longer than this are never an assertion's subject, and keying a map on
 *  one costs real memory — a page source or a base64 screenshot is a command
 *  result too. */
const MAX_READ_VALUE_LENGTH = 256

// Value → the locator of the element whose read produced it, or null when the
// most recent producer was a driver-level read that no element owns. The null is
// load-bearing: a page-title assertion would otherwise inherit the locator of an
// element that happened to have the same text (measured on the mocha example,
// where `h1` and the document title are both "Example Domain").
const selectorByReadValue = new Map<unknown, string | null>()

// Only primitives: an object result is compared by identity, which no assertion
// on a read value relies on, and holding one would pin it for the run.
function isRememberableValue(value: unknown): boolean {
  if (typeof value === 'string') {
    return value.length > 0 && value.length <= MAX_READ_VALUE_LENGTH
  }
  return typeof value === 'number' || typeof value === 'boolean'
}

/** Attribute a command result to the element it was read from, so an assertion
 *  on that value can name the element. Pass `selector: undefined` for a
 *  driver-level read — that records the value as belonging to no element rather
 *  than leaving an older element's claim standing. */
export function rememberReadValue(
  value: unknown,
  selector: string | undefined
): void {
  if (!isRememberableValue(value)) {
    return
  }
  // Delete before set so map order is recency order: the newest producer of a
  // value wins the lookup, and the least recent is what eviction drops.
  selectorByReadValue.delete(value)
  selectorByReadValue.set(value, selector ?? null)
  if (selectorByReadValue.size > MAX_READ_VALUES) {
    const oldest = selectorByReadValue.keys().next()
    if (!oldest.done) {
      selectorByReadValue.delete(oldest.value)
    }
  }
}

/** The element locator this value was read from — undefined when an element read
 *  wasn't its most recent producer. */
export function selectorForReadValue(value: unknown): string | undefined {
  return selectorByReadValue.get(value) ?? undefined
}
