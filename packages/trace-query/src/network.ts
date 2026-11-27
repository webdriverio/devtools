import { requestStatusKind, type NetworkRequest } from '@wdio/devtools-shared'
import { rangeAround } from './action-window.js'
import { sinceStart } from './actions.js'
import { fitted, itemBudgetBeside, pageWith, queryBudgetOf } from './budget.js'
import { MAX_LIST_TEXT_CHARS, PAGE_SCOPE } from './constants.js'
import { allows, countBy, sortedFilter } from './listing-filters.js'
import { traceStateOf, type TraceState } from './open-trace.js'
import {
  ownNetworkSource,
  ownRequestType,
  ownStatusKind
} from './own-unions.js'
import { returnedText } from './returned-text.js'
import { mainOrigin, withoutOrigin } from './short-url.js'
import type {
  NetworkPage,
  NetworkQuery,
  NetworkRow,
  RequestStatusKind,
  TimeRange,
  TraceHandle
} from './types.js'

function statusKindOf(request: NetworkRequest): RequestStatusKind {
  return ownStatusKind(requestStatusKind(request))
}

/** The fields a listing row and a request's detail share, the URL left to each; `cut` caps each text below its own limit. */
export function rowFields(
  state: TraceState,
  request: NetworkRequest,
  cut: number
): Omit<NetworkRow, 'url'> {
  const kind = statusKindOf(request)
  const maxChars = Math.min(MAX_LIST_TEXT_CHARS, cut)
  const shortText = (text: string, textKind: 'method' | 'status-text') =>
    returnedText(text, { state, kind: textKind, maxChars })
  const statusText =
    kind === 'error' && request.statusText
      ? shortText(request.statusText, 'status-text')
      : undefined
  return {
    id: request.id,
    startMs: sinceStart(state.data, request.startTime),
    ...(request.time !== undefined
      ? { durationMs: Math.round(request.time) }
      : {}),
    ...(request.method ? { method: shortText(request.method, 'method') } : {}),
    ...(request.status !== undefined ? { status: request.status } : {}),
    statusKind: kind,
    ...(statusText ? { statusText } : {}),
    type: ownRequestType(request.type),
    ...(request.source ? { source: ownNetworkSource(request.source) } : {})
  }
}

function listedRow(
  state: TraceState,
  request: NetworkRequest,
  origin: string | undefined,
  cut: number
): NetworkRow {
  return {
    ...rowFields(state, request, cut),
    url: returnedText(withoutOrigin(request.url, origin), {
      state,
      kind: 'url',
      maxChars: Math.min(MAX_LIST_TEXT_CHARS, cut)
    })
  }
}

function overlaps(request: NetworkRequest, range: TimeRange | undefined) {
  return (
    !range ||
    (request.startTime <= range.to &&
      (request.endTime ?? request.startTime) >= range.from)
  )
}

function matchingRequests(
  state: TraceState,
  query: NetworkQuery
): NetworkRequest[] {
  const range = rangeAround(state.data, query)
  const needle = query.url?.toLowerCase()
  return [...state.data.trace.networkRequests]
    .sort((a, b) => a.startTime - b.startTime)
    .filter((request) => overlaps(request, range))
    .filter((request) => !needle || request.url.toLowerCase().includes(needle))
}

/** Requests in time order, filtered by status kind, URL and the time around an action; no headers or bodies. */
export function traceNetwork(
  handle: TraceHandle,
  query: NetworkQuery = {}
): NetworkPage {
  queryBudgetOf(query.maxChars)
  const state = traceStateOf(handle)
  const matched = matchingRequests(state, query)
  const origin = mainOrigin(state.data.trace.networkRequests)
  const extra = {
    ...(origin
      ? {
          origin: returnedText(origin, {
            state,
            kind: 'origin',
            maxChars: MAX_LIST_TEXT_CHARS
          })
        }
      : {}),
    byStatus: countBy(matched, statusKindOf)
  }
  const kept = matched.filter((request) =>
    allows(query.status, statusKindOf(request))
  )
  const scope = JSON.stringify([
    PAGE_SCOPE.NETWORK,
    sortedFilter(query.status),
    query.url,
    query.action,
    query.windowMs
  ])
  const budget = itemBudgetBeside(kept.length, query, scope, extra)
  const rows = kept.map((request) =>
    fitted(
      (cut) => listedRow(state, request, origin, cut),
      MAX_LIST_TEXT_CHARS,
      budget
    )
  )
  return pageWith(rows, query, { scope }, extra)
}
