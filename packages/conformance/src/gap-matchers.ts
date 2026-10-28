import { ADAPTERS } from './adapters.js'
import { testLabel } from './step-alignment.js'
import type { AdapterId, MessageMatcher } from './types.js'

/** One hunk of the comparison, matched on the holder's own clause and the other side's content in either order, so it never depends on which adapter is the reference. */
export function hunk(
  test: number,
  after: string,
  holder: AdapterId,
  holderShows: string,
  otherShows: string
): MessageMatcher {
  return shows(
    `${testLabel(test)}, after ${after}: `,
    holder,
    holderShows,
    otherShows
  )
}

/** One hunk of the steps a step issued, compared under it: {@link hunk} inside `parent`. */
export function insideHunk(
  test: number,
  parent: string,
  after: string,
  holder: AdapterId,
  holderShows: string,
  otherShows: string
): MessageMatcher {
  return shows(
    `${testLabel(test)}, ${parent}, inside it after ${after}: `,
    holder,
    holderShows,
    otherShows
  )
}

function shows(
  lead: string,
  holder: AdapterId,
  holderShows: string,
  otherShows: string
): MessageMatcher {
  const own = `${holder} shows [${holderShows}]`
  return (message) => {
    const at = message.indexOf(lead)
    const rest = at === -1 ? undefined : message.slice(at + lead.length)
    return ADAPTERS.some(({ id }) => {
      const other = `${id} shows [${otherShows}]`
      return (
        id !== holder &&
        (rest === `${other}, ${own}` || rest === `${own}, ${other}`)
      )
    })
  }
}

/** A step the holder shows at some other place in the test than where the other adapter shows it, after `otherAfter`. */
export function moved(
  test: number,
  key: string,
  holder: AdapterId,
  otherAfter: string
): MessageMatcher {
  const lead = `${testLabel(test)}: ${key} comes after `
  return (message) => {
    const at = message.indexOf(lead)
    const rest = at === -1 ? '' : message.slice(at + lead.length)
    return ADAPTERS.some(({ id }) => {
      const other = `${otherAfter} in ${id}`
      return (
        id !== holder &&
        rest.endsWith(` in ${holder}`) &&
        (rest.startsWith(`${other}, after `) ||
          rest.endsWith(`, after ${other}`))
      )
    })
  }
}

export const anyOf =
  (...matchers: MessageMatcher[]): MessageMatcher =>
  (message) =>
    matchers.some((m) => m(message))
