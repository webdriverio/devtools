import { BOOLEAN_COMMAND_PATTERN } from '../constants.js'

/**
 * Convert the raw value Nightwatch's async queue hands back to a
 * UI-friendly JSON-safe representation. Three special cases:
 *
 *  - Nightwatch assertion objects `{ passed, actual, expected, message }`
 *    collapse to `true` on pass, or the structured failure record on fail.
 *  - Driver-result wrappers `{ value: <raw> }` unwrap to the inner value.
 *    `null` on a boolean-semantic command (e.g. `waitForExist`) means
 *    "timed out / not found" — coerce to `false` so the UI doesn't render
 *    `null`.
 *  - Plain objects are deep-cloned via JSON.parse/stringify so the UI can
 *    safely serialize them; functions and circular references fall back to
 *    `String(value)`.
 */
export function serializeCommandResult(
  callbackResult: unknown,
  methodName: string
): unknown {
  if (callbackResult === null || callbackResult === undefined) {
    return undefined
  }

  const isBooleanCommand = BOOLEAN_COMMAND_PATTERN.test(methodName)

  // After the typeof + null guard above, the value is a non-null object —
  // safe to widen via `Record<string, unknown>` and probe for the discriminator
  // properties without per-access `as any`.
  if (typeof callbackResult === 'object') {
    const r = callbackResult as Record<string, unknown>
    if ('passed' in r) {
      return r.passed
        ? true
        : {
            passed: false,
            actual: r.actual,
            expected: r.expected,
            message: r.message
          }
    }
    if ('value' in r) {
      const raw = r.value
      return raw === null && isBooleanCommand ? false : raw
    }
  }

  if (typeof callbackResult !== 'function') {
    try {
      return JSON.parse(JSON.stringify(callbackResult))
    } catch {
      return String(callbackResult)
    }
  }

  return undefined
}
