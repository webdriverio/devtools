/**
 * The failure a Nightwatch command reports by invoking its callback with an
 * error-shaped result instead of throwing.
 *
 * Only a SYNCHRONOUS failure reaches the try/catch around the wrapped method; an
 * async one (a command that times out waiting for an element) arrives here as a
 * result object. Left in `result`, the row kept `error: undefined` and rendered
 * as a success — the failure was readable only as raw text in the result pane,
 * with no red row and nothing in the Errors tab.
 *
 * `passed` present means this is an assertion result, which carries its own
 * pass/fail handling and must not be reinterpreted here.
 */
export function callbackError(result: unknown, depth = 0): Error | undefined {
  if (result instanceof Error) {
    return result
  }
  if (!result || typeof result !== 'object') {
    return undefined
  }
  const r = result as Record<string, unknown>
  // W3C driver responses nest their payload under `value` and Nightwatch passes
  // that wrapper through untouched, so the failure sits one level down — reading
  // only the top level found no `error` and the row stayed green. Depth-bounded:
  // this runs inside the command hook, so a self-referencing result must not be
  // able to overflow the stack and take the user's test down with it.
  if ('value' in r) {
    return depth < 2 ? callbackError(r.value, depth + 1) : undefined
  }
  if ('passed' in r || !r.error) {
    return undefined
  }
  const err = new Error(String(r.message ?? r.error))
  if (typeof r.stack === 'string') {
    err.stack = r.stack
  }
  return err
}
