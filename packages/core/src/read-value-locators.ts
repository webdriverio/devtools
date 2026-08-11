// Value → locator provenance: which element's read produced a given value.
//
// node:assert takes VALUES, not elements — `assert.equal(await el.getText(), …)`
// names no element — so an assertion row can only name its target if something
// remembers which element each read value came from. Adapters feed this from
// their command path (where a read's result and its selector are both visible)
// and read it back when a patched assert fires; the answer lands on
// `CommandLog.selector` so the player's overlay boxes the assertion's subject.
//
// Framework-agnostic by construction: it stores primitives and selector strings
// only. The complementary handle → locator map (an assert taking the element
// object itself) is Selenium-specific and stays in that adapter.

/** Bounds the registry. A run reads far more values than any assertion looks
 *  back over, and only the recent ones can be an assert's subject. */
const MAX_READ_VALUES = 200

/** Values longer than this are never an assertion's subject, and keying a map on
 *  one costs real memory — a page source or a base64 screenshot is a command
 *  result too. */
const MAX_READ_VALUE_LENGTH = 256

// Value → the locator of the element whose read produced it, or null when the
// most recent producer was a driver-level read that no element owns. The null is
// load-bearing: a page-title assertion would otherwise inherit the locator of an
// element that happened to have the same text (measured on the selenium mocha
// example, where `h1` and the document title are both "Example Domain").
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

/**
 * The element an assert was about, from its RAW args (sanitizing loses the
 * object identity a handle is recognised by). First arg that resolves wins —
 * node:assert puts the subject first. `fromHandle` lets an adapter that also
 * tracks element handles answer for an element passed straight to the assert;
 * adapters whose asserts only ever see values omit it.
 */
export function resolveAssertTargetFromArgs(
  args: unknown[],
  fromHandle?: (arg: unknown) => string | undefined
): string | undefined {
  for (const arg of args) {
    const selector = fromHandle?.(arg) ?? selectorForReadValue(arg)
    if (selector) {
      return selector
    }
  }
  return undefined
}
