import { serializeError } from '@wdio/devtools-core'
import type { SerializedError } from '@wdio/devtools-shared'

// webdriver's WebDriverResponseError rewrites its message as
// `WebDriverError: <browser's message> when running "<endpoint>" with method "<M>"[ and args <...>]`
// and keeps no copy of the browser's text, so the row recovers it from that one documented shape.
const DECORATION_PREFIX = 'WebDriverError: '
const DECORATION_MARKER = ' when running "'
const DECORATION_TAIL = /^ when running "[^"]*" with method "[A-Z]+"/
const DECORATION_ARGS = ' and args '

function browserMessageOf(message: string): string | undefined {
  if (!message.startsWith(DECORATION_PREFIX)) {
    return undefined
  }
  const at = message.indexOf(DECORATION_MARKER, DECORATION_PREFIX.length)
  const tail = at === -1 ? undefined : DECORATION_TAIL.exec(message.slice(at))
  if (!tail) {
    return undefined
  }
  const rest = message.slice(at + tail[0].length)
  if (rest !== '' && !rest.startsWith(DECORATION_ARGS)) {
    return undefined
  }
  return message.slice(DECORATION_PREFIX.length, at)
}

/** A failed command's error as the row carries it: the browser's own message, serialized for the socket. */
export function serializeCommandError(
  error: Error | undefined
): SerializedError | undefined {
  const serialized = serializeError(error)
  if (!serialized) {
    return undefined
  }
  const message = browserMessageOf(serialized.message)
  return message === undefined ? serialized : { ...serialized, message }
}
