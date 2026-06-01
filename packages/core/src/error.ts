/** Plain-object shape of an Error after `serializeError`. */
export interface SerializedError {
  name: string
  message: string
  stack?: string
}

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
): SerializedError | undefined {
  if (!error) {
    return undefined
  }
  return { name: error.name, message: error.message, stack: error.stack }
}
