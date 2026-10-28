import { ADAPTERS } from './adapters.js'
import { SCENARIO_TESTS } from './constants.js'
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
  const lead = `${testLabel(test)}, after ${after}: `
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

/** A scenario test the suite tree reports in a given state. */
export function reportedAs(test: number, state: string): MessageMatcher {
  const lead = `"${SCENARIO_TESTS[test].title}" is reported ${state};`
  return (message) => message.startsWith(lead)
}

export const anyOf =
  (...matchers: MessageMatcher[]): MessageMatcher =>
  (message) =>
    matchers.some((m) => m(message))
