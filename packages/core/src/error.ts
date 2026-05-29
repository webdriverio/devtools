import type { TestError } from '@wdio/devtools-shared'

/**
 * Normalize an Error to a plain object so its fields survive `JSON.stringify`
 * over the WS bridge. Error instances have `message`/`name`/`stack` as
 * non-enumerable, which `JSON.stringify` would drop.
 *
 * Returns `undefined` when the input is undefined so callers can pass through
 * possibly-undefined values without an extra branch.
 */
export function serializeError(
  error: Error | undefined
): TestError | undefined {
  if (!error) {
    return undefined
  }
  return { name: error.name, message: error.message, stack: error.stack }
}
