import {
  formatTraceLink,
  parseTraceLink,
  TRACE_URL_PARAM,
  type TraceLink
} from '@wdio/devtools-shared'

/** The position in the trace the page's address links to. */
export function currentTraceLink(): TraceLink {
  return parseTraceLink(window.location.hash)
}

function replaceAddress(url: URL): void {
  if (url.href !== window.location.href) {
    history.replaceState(history.state, '', url)
  }
}

/** Records `update` in the address without a history entry; a key set to `undefined` is removed. */
export function updateTraceLink(update: TraceLink): void {
  const url = new URL(window.location.href)
  url.hash = formatTraceLink({ ...currentTraceLink(), ...update })
  replaceAddress(url)
}

const LITERAL_URL = /^(?:[a-z][a-z\d+.-]*:|\/)/i
const TRACE_PARAM = `${TRACE_URL_PARAM}=`

/** Where `trace=` starts in a page query (its `?` or `&` included), or -1. */
function traceParamIndex(search: string): number {
  return search.startsWith(`?${TRACE_PARAM}`)
    ? 0
    : search.indexOf(`&${TRACE_PARAM}`)
}

/** The `trace` value of a page query: everything after `trace=`, so an unencoded URL keeps its own `&` parameters. */
export function traceParamFrom(search: string): string | null {
  const index = traceParamIndex(search)
  if (index < 0) {
    return null
  }
  const raw = search.slice(index + 1 + TRACE_PARAM.length)
  // A literal URL is taken as written; anything else is the percent-encoded form.
  if (LITERAL_URL.test(raw)) {
    return raw
  }
  // An encoded value holds no raw `&`, so one ends it: what follows is the page's own parameter.
  const encoded = raw.split('&')[0]
  try {
    return decodeURIComponent(encoded.replace(/\+/g, ' '))
  } catch {
    return encoded
  }
}

/** Drops the link and the `?trace=` URL, and every parameter after it, from the address once it no longer names the trace on screen. */
export function clearTraceAddress(): void {
  const url = new URL(window.location.href)
  const index = traceParamIndex(url.search)
  if (index >= 0) {
    url.search = url.search.slice(0, index)
  }
  url.hash = ''
  replaceAddress(url)
}

/** Whether the page was opened with a `?trace=` URL. */
export function hasTraceParam(): boolean {
  return traceParamIndex(window.location.search) >= 0
}
