/** Plain-object shape of an Error after `serializeError`. */
export interface SerializedError {
  name: string
  message: string
  stack?: string
}

/**
 * Coerce an unknown value (caught exception, framework-supplied error
 * object, string, etc.) into an Error instance. Used at adapter command
 * boundaries where caught values can be anything — Error subclasses,
 * thrown strings, framework objects with a `.message` — and downstream
 * code wants a stable `Error` to inspect and serialize.
 */
export function toError(value: unknown): Error {
  if (value instanceof Error) {
    return value
  }
  if (
    value !== null &&
    typeof value === 'object' &&
    typeof (value as { message?: unknown }).message === 'string'
  ) {
    const e = new Error((value as { message: string }).message)
    const name = (value as { name?: unknown }).name
    if (typeof name === 'string') {
      e.name = name
    }
    return e
  }
  return new Error(String(value))
}

/**
 * Extract a printable message from a caught value. Equivalent to reading
 * `.message` on an Error, but degrades cleanly when the thrown value is a
 * string, a plain object, undefined, or anything else — `(err as Error).message`
 * silently returns `undefined` in those cases and yields useless log output.
 */
export function errorMessage(value: unknown): string {
  if (value instanceof Error) {
    return value.message
  }
  if (typeof value === 'string') {
    return value
  }
  if (
    value !== null &&
    typeof value === 'object' &&
    typeof (value as { message?: unknown }).message === 'string'
  ) {
    return (value as { message: string }).message
  }
  if (value === undefined || value === null) {
    return 'unknown error'
  }
  try {
    return String(value)
  } catch {
    return 'unknown error'
  }
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
