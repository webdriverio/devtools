import { DEFAULT_MAX_CHARS } from './constants.js'
import type { Page, PageRequest, TruncatedText } from './types.js'

// The list's length rides in the cursor, so a cursor handed back to a different listing is refused rather than read as an offset into it.
const CURSOR = /^(0|[1-9]\d*)\/(0|[1-9]\d*)$/

function offsetOf(cursor: string | undefined, total: number): number {
  if (cursor === undefined) {
    return 0
  }
  const match = CURSOR.exec(cursor)
  if (!match) {
    throw new Error(
      `Invalid cursor ${JSON.stringify(cursor)}: pass back the nextCursor of the previous page`
    )
  }
  const offset = Number(match[1])
  if (Number(match[2]) !== total || offset > total) {
    throw new Error(
      `The cursor ${JSON.stringify(cursor)} belongs to a different listing: pass it back only to the query that returned it`
    )
  }
  return offset
}

function budgetOf(maxChars: number | undefined): number {
  const budget = maxChars ?? DEFAULT_MAX_CHARS
  if (!Number.isInteger(budget) || budget < 1) {
    throw new Error(`maxChars must be a positive integer, got ${budget}`)
  }
  return budget
}

function serializedLength(item: unknown): number {
  return JSON.stringify(item)?.length ?? 0
}

/** The items from the cursor on whose serialized length fits the budget. A page always holds one item, so paging advances; an item larger than the budget comes back whole, so a query cuts its long fields before paging. */
export function pageOf<T>(
  items: readonly T[],
  request: PageRequest = {},
  size: (item: T) => number = serializedLength
): Page<T> {
  const start = offsetOf(request.cursor, items.length)
  const budget = budgetOf(request.maxChars)
  const page: T[] = []
  let used = 0
  for (let at = start; at < items.length; at++) {
    const cost = size(items[at]!)
    if (page.length > 0 && used + cost > budget) {
      break
    }
    page.push(items[at]!)
    used += cost
  }
  const next = start + page.length
  return {
    items: page,
    total: items.length,
    ...(next < items.length ? { nextCursor: `${next}/${items.length}` } : {})
  }
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff
}

/** Cuts text to the budget in UTF-16 code units, never inside a surrogate pair, saying how long it was. */
export function truncateText(text: string, maxChars?: number): TruncatedText {
  const budget = budgetOf(maxChars)
  if (text.length <= budget) {
    return { text, totalChars: text.length, truncated: false }
  }
  const end = isHighSurrogate(text.charCodeAt(budget - 1)) ? budget - 1 : budget
  return { text: text.slice(0, end), totalChars: text.length, truncated: true }
}
