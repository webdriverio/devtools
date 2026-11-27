declare const traceHandleBrand: unique symbol

/** An opened trace. Every query takes one; what it holds is not part of the API. */
export interface TraceHandle {
  readonly [traceHandleBrand]: true
}

export interface PageRequest {
  /** Where the previous page of the same query stopped, as it returned in `nextCursor`. */
  cursor?: string
  maxChars?: number
}

export interface Page<T> {
  items: T[]
  /** Items in the whole result, across every page. */
  total: number
  /** Present while items remain; pass it back as `cursor` to the same query for the next page. */
  nextCursor?: string
}

export interface TruncatedText {
  text: string
  /** Characters in the text before it was cut. */
  totalChars: number
  truncated: boolean
}
