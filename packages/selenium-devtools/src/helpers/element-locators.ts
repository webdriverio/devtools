// Recovers the locator an element command acted through: Selenium consumes it at
// `findElement` time and hands back an opaque handle, so the command itself sees
// only the handle. The row carries the result as `CommandLog.selector`.
//
// Selenium-specific by nature — it keys on `WebElement` handle identity. The
// companion question an assertion asks ("which element produced this VALUE") is
// framework-agnostic and lives in core's `read-value-locators`.

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
