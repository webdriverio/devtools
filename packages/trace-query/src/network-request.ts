import { resourceTimingNote, type NetworkRequest } from '@wdio/devtools-shared'
import { fitted, positiveInteger, queryBudgetOf } from './budget.js'
import {
  DEFAULT_MAX_CHARS,
  DETAIL_VALUE_MAX_CHARS,
  MAX_BODY_BYTES,
  MAX_LIST_TEXT_CHARS,
  MIN_TEXT_CHARS
} from './constants.js'
import { rowFields } from './network.js'
import { traceStateOf, type TraceState } from './open-trace.js'
import { returnedText } from './returned-text.js'
import type {
  HeaderField,
  TraceHandle,
  TraceNetworkRequestDetail,
  TraceNetworkRequestOptions
} from './types.js'

const size = (value: unknown) => JSON.stringify(value).length

// Room kept for `,"omittedHeaders":<n>`, so naming what was left out never overruns the budget.
const OMITTED_HEADERS_RESERVE = 25
// A field's characters beside the object it joins: its name, the colon, the empty value's quotes and the comma before it.
const BODY_FIELD_CHARS = size({ body: '' }) - 1
const UNAVAILABLE_FIELD_CHARS = size({ bodyUnavailable: '' }) - 1
// Room kept for a body, or the reason there is none, whatever the headers take.
const BODY_RESERVE = MIN_TEXT_CHARS + UNAVAILABLE_FIELD_CHARS
const BODY_TOO_LARGE = 'The body does not fit; ask with a larger maxChars'

function measuredTimings(
  request: NetworkRequest
): Record<string, number> | undefined {
  const phases = Object.entries(request.timings ?? {}).filter(
    (phase): phase is [string, number] => typeof phase[1] === 'number'
  )
  return phases.length
    ? Object.fromEntries(phases.map(([name, ms]) => [name, Math.round(ms)]))
    : undefined
}

/** The request without headers or body, each text cut at `cut` below its own limit. */
function baseDetail(
  state: TraceState,
  request: NetworkRequest,
  cut: number
): TraceNetworkRequestDetail {
  const mimeType = request.response?.mimeType
  const timingsMs = measuredTimings(request)
  const note = resourceTimingNote(request)
  return {
    ...rowFields(state, request, cut),
    url: returnedText(request.url, {
      state,
      kind: 'url',
      maxChars: Math.min(DETAIL_VALUE_MAX_CHARS, cut)
    }),
    ...(mimeType
      ? {
          mimeType: returnedText(mimeType, {
            state,
            kind: 'mime-type',
            maxChars: Math.min(MAX_LIST_TEXT_CHARS, cut)
          })
        }
      : {}),
    ...(request.size !== undefined ? { size: request.size } : {}),
    ...(timingsMs ? { timingsMs } : {}),
    ...(note ? { note } : {})
  }
}

interface Header {
  field: HeaderField
  name: string
  value: string
}

function headerEntry(state: TraceState, header: Header, maxChars: number) {
  const { field, name, value } = header
  return [
    returnedText(name, {
      state,
      kind: 'header-name',
      field,
      maxChars: MAX_LIST_TEXT_CHARS
    }),
    returnedText(value, { state, kind: 'header', field, name, maxChars })
  ] as const
}

/** The header that fits `room` whole or with its value cut, as the characters it adds; `opened` when its map already holds one. */
function fittingHeader(
  state: TraceState,
  header: Header,
  room: number,
  opened: boolean
) {
  // A header costs its name and value as JSON and a colon, plus a comma, or its map's own `,"field":{}` when it is the first.
  const overhead = 1 + (opened ? 1 : header.field.length + 6)
  const entry = fitted(
    (maxChars) => headerEntry(state, header, maxChars),
    DETAIL_VALUE_MAX_CHARS,
    room - overhead + 3
  )
  const cost = size(entry[0]) + size(entry[1]) + overhead
  return cost <= room ? { entry, cost } : undefined
}

/** Headers in order while they fit `room`, values cut first; the rest are counted, not listed. */
function headersWithin(
  state: TraceState,
  request: NetworkRequest,
  room: number
): Pick<
  TraceNetworkRequestDetail,
  'requestHeaders' | 'responseHeaders' | 'omittedHeaders'
> {
  const headers: Header[] = (
    ['requestHeaders', 'responseHeaders'] as const
  ).flatMap((field) =>
    Object.entries(request[field] ?? {}).map(([name, value]) => ({
      field,
      name,
      value
    }))
  )
  const maps: Partial<Record<HeaderField, Record<string, string>>> = {}
  let left = room - OMITTED_HEADERS_RESERVE
  let omitted = 0
  for (const header of headers) {
    const fit = fittingHeader(state, header, left, header.field in maps)
    if (!fit) {
      omitted++
      continue
    }
    const map = maps[header.field] ?? {}
    // Two long names can cut to the same text; the later one is counted as left out rather than overwriting the first.
    if (Object.prototype.hasOwnProperty.call(map, fit.entry[0])) {
      omitted++
      continue
    }
    left -= fit.cost
    maps[header.field] = { ...map, [fit.entry[0]]: fit.entry[1] }
  }
  return { ...maps, ...(omitted ? { omittedHeaders: omitted } : {}) }
}

async function storedBody(
  { archive }: TraceState,
  entry: string
): Promise<string | { unavailable: string }> {
  const declared = archive.sizeOf(entry)
  if (declared === undefined) {
    return { unavailable: 'The zip declares no size for the stored body' }
  }
  if (declared > MAX_BODY_BYTES) {
    return {
      unavailable: `The stored body is ${declared} bytes, over the ${MAX_BODY_BYTES}-byte read limit`
    }
  }
  try {
    return new TextDecoder().decode(await archive.read(entry))
  } catch (error) {
    return {
      unavailable: `The stored body could not be read: ${error instanceof Error ? error.message : String(error)}`
    }
  }
}

async function bodyText(
  state: TraceState,
  request: NetworkRequest
): Promise<string | { unavailable: string }> {
  if (request.responseBody !== undefined) {
    return request.responseBody
  }
  const entry = state.data.responseBodies?.[request.id]
  return entry
    ? storedBody(state, entry)
    : { unavailable: 'The trace stored no body for this request' }
}

/** The body cut to `room`, capped by maxBodyChars, or why none came back. */
async function bodyWithin(
  state: TraceState,
  request: NetworkRequest,
  room: number,
  maxBodyChars: number
): Promise<Pick<TraceNetworkRequestDetail, 'body' | 'bodyUnavailable'>> {
  const text = await bodyText(state, request)
  if (typeof text !== 'string') {
    return {
      bodyUnavailable: returnedText(text.unavailable, {
        state,
        kind: 'body-unavailable',
        maxChars: Math.min(MAX_LIST_TEXT_CHARS, room)
      })
    }
  }
  const mimeType = request.response?.mimeType
  const budget = room + size({ body: '' })
  // A body escapes to more characters than it holds (a newline is two), so it is cut below the usual floor, and left out only when nothing of it fits.
  const body = fitted(
    (maxChars) => ({
      body: returnedText(text, {
        state,
        kind: 'body',
        maxChars,
        ...(mimeType ? { mimeType } : {})
      })
    }),
    Math.min(maxBodyChars, room),
    budget,
    1
  )
  return size(body) <= budget
    ? body
    : {
        bodyUnavailable: returnedText(BODY_TOO_LARGE, {
          state,
          kind: 'body-unavailable',
          maxChars: Math.min(MAX_LIST_TEXT_CHARS, room)
        })
      }
}

function requestOf(state: TraceState, id: string): NetworkRequest {
  const request = state.data.trace.networkRequests.find((row) => row.id === id)
  if (!request) {
    throw new Error(`The trace has no request ${JSON.stringify(id)}`)
  }
  return request
}

/** One request within `maxChars`: its fields, then its headers while they fit, then its response body when asked for, read from the zip only then. */
export async function traceNetworkRequest(
  handle: TraceHandle,
  id: string,
  options: TraceNetworkRequestOptions = {}
): Promise<TraceNetworkRequestDetail> {
  const budget = queryBudgetOf(options.maxChars)
  const state = traceStateOf(handle)
  const request = requestOf(state, id)
  const maxBodyChars = positiveInteger(
    'maxBodyChars',
    options.maxBodyChars ?? DEFAULT_MAX_CHARS
  )
  const base = fitted(
    (cut) => baseDetail(state, request, cut),
    DETAIL_VALUE_MAX_CHARS,
    Math.floor(budget / 2)
  )
  const withHeaders = {
    ...base,
    ...headersWithin(
      state,
      request,
      budget - size(base) - (options.body ? BODY_RESERVE : 0)
    )
  }
  if (!options.body) {
    return withHeaders
  }
  const room =
    budget -
    size(withHeaders) -
    Math.max(BODY_FIELD_CHARS, UNAVAILABLE_FIELD_CHARS)
  return {
    ...withHeaders,
    ...(await bodyWithin(state, request, room, maxBodyChars))
  }
}
