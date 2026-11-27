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

export interface OpenTraceOptions {
  /** Directories a local path must resolve inside, after symlinks; none means local paths are refused. */
  allowedRoots?: readonly string[]
  /** Hosts a URL may be fetched from: an exact name, or `*.example.com` for its subdomains; none means URLs are refused. */
  allowedHosts?: readonly string[]
  /** Fetch from loopback, private and link-local addresses too. */
  allowPrivateNetwork?: boolean
  /** Largest zip read, in bytes. */
  maxZipBytes?: number
  /** Most the entries a trace's payload is built from may declare inflating to, in bytes. */
  maxInflatedBytes?: number
}

/** Which test to open, as a span or a manifest names it; uid and spec file together, since tests with the same title share a uid. */
export interface TraceTarget {
  uid: string
  specFile?: string
  /** The final attempt unless named. */
  attempt?: number
  /** The session the test ran in, when one uid and spec file ran in several (the same test on two browsers). */
  sessionId?: string
}

/** The test a trace was opened for, as its artifacts manifest records it. */
export interface TraceSelection {
  uid: string
  title: string
  specFile: string
  attempt: number
  state?: string
  /** The zip also holds other tests or earlier attempts, so a query narrows to this one. */
  sharedZip: boolean
}

export interface OpenedTrace {
  handle: TraceHandle
  /** The zip opened: a real path, or the URL without its query string. */
  source: string
  test?: TraceSelection
}

export interface HttpResponse {
  status: number
  location?: string
  contentLength?: number
  body: AsyncIterable<Uint8Array>
  discard(): void
}

/** One GET of a URL, without following redirects; injectable so tests need no server. */
export type HttpGet = (url: URL) => Promise<HttpResponse>
