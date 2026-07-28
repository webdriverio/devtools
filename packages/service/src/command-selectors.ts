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
