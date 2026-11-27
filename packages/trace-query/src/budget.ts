import { DEFAULT_MAX_CHARS, MIN_QUERY_CHARS } from './constants.js'
import type { Page, PageOptions, PageRequest, TruncatedText } from './types.js'

// The cursor carries the list's length and its scope's fingerprint, so one handed to a different listing is refused rather than read as an offset into it.
const CURSOR = /^(0|[1-9]\d*)\/(0|[1-9]\d*)\/([0-9a-f]{8})$/

const FNV_OFFSET = 0x811c9dc5
const FNV_PRIME = 0x01000193

// The fingerprint only tells listings apart and guards nothing secret, so a 32-bit FNV-1a hash is enough.
function fingerprint(scope: string): string {
  let hash = FNV_OFFSET
  for (let at = 0; at < scope.length; at++) {
    hash = Math.imul(hash ^ scope.charCodeAt(at), FNV_PRIME) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

function cursorAt(offset: number, total: number, scope: string): string {
  return `${offset}/${total}/${fingerprint(scope)}`
}

function offsetOf(
  cursor: string | undefined,
  total: number,
  scope: string
): number {
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
  if (
    Number(match[2]) !== total ||
    offset > total ||
    match[3] !== fingerprint(scope)
  ) {
    throw new Error(
      `The cursor ${JSON.stringify(cursor)} belongs to a different listing: pass it back only to the query that returned it`
    )
  }
  return offset
}

/** The character budget a request names, or the default; refuses one that is not a positive integer. */
export function budgetOf(maxChars: number | undefined): number {
  const budget = maxChars ?? DEFAULT_MAX_CHARS
  if (!Number.isInteger(budget) || budget < 1) {
    throw new Error(`maxChars must be a positive integer, got ${budget}`)
  }
  return budget
}

/** A query's budget: refuses one below MIN_QUERY_CHARS, the smallest every query's result is held within. */
export function queryBudgetOf(maxChars: number | undefined): number {
  const budget = budgetOf(maxChars)
  if (budget < MIN_QUERY_CHARS) {
    throw new Error(
      `maxChars must be at least ${MIN_QUERY_CHARS}, got ${budget}: a smaller result cannot hold what a query returns`
    )
  }
  return budget
}

function serializedLength(item: unknown): number {
  return JSON.stringify(item)?.length ?? 0
}

// The wrapper and a cursor as long as any this listing can return, so a full page fits whatever cursor it ends with.
function wrapperLength(total: number, scope: string): number {
  return serializedLength({
    items: [],
    total,
    nextCursor: cursorAt(total, total, scope)
  })
}

/** What a page's items may take of a budget once the wrapper is paid for. */
export function itemBudget(
  total: number,
  maxChars: number | undefined,
  scope = ''
): number {
  return budgetOf(maxChars) - wrapperLength(total, scope)
}

/** The items from the cursor on that fit the budget, wrapper and separators included. A page always holds one item, so paging advances; an item larger than the budget comes back whole, so a query cuts its long fields before paging. */
export function pageOf<T>(
  items: readonly T[],
  request: PageRequest = {},
  { scope = '', size = serializedLength }: PageOptions<T> = {}
): Page<T> {
  const start = offsetOf(request.cursor, items.length, scope)
  const budget = itemBudget(items.length, request.maxChars, scope)
  const page: T[] = []
  let used = 0
  for (let at = start; at < items.length; at++) {
    const cost = size(items[at]!) + (page.length > 0 ? 1 : 0)
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
    ...(next < items.length
      ? { nextCursor: cursorAt(next, items.length, scope) }
      : {})
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

/** Text cut so that it and a note of its whole length fit `maxChars`; a budget shorter than the note still gets one character and the note. */
export function clipText(text: string, maxChars: number): string {
  if (text.length <= budgetOf(maxChars)) {
    return text
  }
  const note = `… (cut, ${text.length} chars)`
  return `${truncateText(text, Math.max(1, maxChars - note.length)).text}${note}`
}

/** A value as JSON, so a string reads apart from a number, cut by `clipText`; undefined when it has no JSON form. */
export function clipValue(
  value: unknown,
  maxChars: number
): string | undefined {
  const json = JSON.stringify(value) as string | undefined
  return json === undefined ? undefined : clipText(json, maxChars)
}
