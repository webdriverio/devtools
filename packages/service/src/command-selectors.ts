// Selector bookkeeping for command rows. WDIO invokes element-scoped commands
// with a resolved element handle, so the selector the user actually wrote is
// only observable on the preceding locator command and has to be carried
// forward onto the row.

import { LOCATOR_COMMANDS, SELECTOR_INHERITING_COMMANDS } from './constants.js'
import type { CommandLog } from './types.js'

/** The selector to remember after this command: a locator command's own
 *  argument, otherwise the one already remembered. */
export function nextLastSelector(
  command: string,
  args: unknown[],
  current: string | undefined
): string | undefined {
  if (!LOCATOR_COMMANDS.includes(command)) {
    return current
  }
  const selector = args[0]
  return typeof selector === 'string' && selector.length > 0
    ? selector
    : current
}

/** The W3C element id inside a serialized handle (`{'element-6066-…': '<id>'}`).
 *  WDIO's hook only ever sees the serialized form, never the live object — the
 *  reverse of Selenium, which has the object and no readable id. */
function elementId(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined
  }
  for (const [key, id] of Object.entries(value)) {
    if (key.startsWith('element-') && typeof id === 'string' && id) {
      return id
    }
  }
  return undefined
}

/** Selector each resolved element was found by. A locator command's *result* is
 *  the handle the test will act through, so its id is a durable key — the
 *  single mutable slot below cannot survive `$('#a'); $('#b'); a.click()`,
 *  which stamped the row with `#b`. */
const selectorById = new Map<string, string>()

/** A runaway guard, deliberately NOT the tight bound core's value registry uses.
 *  That one holds a lookback window — an assert fires just after the read whose
 *  value it names, so old entries are useless. A handle has no such property: it
 *  can be resolved at the top of a test and acted on far later, and evicting it
 *  silently restores the very bug this map fixes. The real bound is
 *  `forgetElementSelectors()` per test; this only catches a standalone script,
 *  which has no test hook to reset on. ~120 bytes an entry. */
const MAX_TRACKED_ELEMENTS = 5000

export function rememberElementSelector(
  command: string,
  args: unknown[],
  result: unknown
): void {
  if (!LOCATOR_COMMANDS.includes(command)) {
    return
  }
  const id = elementId(result)
  const selector = args[0]
  if (!id || typeof selector !== 'string' || !selector) {
    return
  }
  if (selectorById.size >= MAX_TRACKED_ELEMENTS) {
    selectorById.delete(selectorById.keys().next().value as string)
  }
  selectorById.set(id, selector)
}

/** The selector for THIS command: the handle it was invoked with wins, so
 *  interleaved handles each keep their own; the mutable slot remains the
 *  fallback for commands that carry no handle at all. */
export function selectorForCommand(
  args: unknown[],
  lastSelector: string | undefined
): string | undefined {
  const id = elementId(args[0])
  return (id && selectorById.get(id)) ?? lastSelector
}

export function forgetElementSelectors(): void {
  selectorById.clear()
}

/** True when the args carry no readable selector — either empty, or a single
 *  WebDriver element handle (`{'element-6066-…': '…'}`). */
function hasNoSelectorArg(args: unknown[]): boolean {
  if (args.length === 0) {
    return true
  }
  return (
    args.length === 1 &&
    typeof args[0] === 'object' &&
    args[0] !== null &&
    !Array.isArray(args[0]) &&
    Object.keys(args[0] as object).some((key) => key.startsWith('element-'))
  )
}

/** Stamp the remembered selector onto an entry so the trace row shows what
 *  element was acted upon. `setValue`/`addValue` keep their value argument and
 *  gain the selector in front, so params read as {selector, value} — the same
 *  shape the MCP set_value tool reports. */
export function decorateSelector(
  entry: CommandLog,
  command: string,
  args: unknown[],
  lastSelector: string | undefined
): void {
  if (!lastSelector) {
    return
  }
  if (SELECTOR_INHERITING_COMMANDS.includes(command)) {
    if (hasNoSelectorArg(args)) {
      entry.args = [lastSelector]
    }
    entry.selector = lastSelector
    return
  }
  if (command === 'setValue' || command === 'addValue') {
    if (args.length >= 1 && typeof args[0] !== 'object') {
      entry.args = [lastSelector, ...args]
    }
  }
}
