// Shared request-detail block (General + request/response headers + bodies).
// Reused by the live Network panel (DevtoolsNetwork) and the trace-player's
// network drawer (TraceTimeline). The returned markup relies on `networkStyles`
// being present in the host component's shadow root.

import type { NetworkRequest } from '@wdio/devtools-shared'
import { html, nothing, type TemplateResult } from 'lit'
import {
  formatBytes,
  formatTime,
  statusKind,
  contentType
} from '../../../utils/network-helpers.js'
import { FAILED_STATUS_LABEL } from '../../../utils/network-constants.js'

// The capture side reports a transport failure as status 0 carrying the failure
// text in `statusText` (service's `handleNetworkFetchError`), so 0 is a failure
// that happened — never a status still on its way.
const TRANSPORT_FAILURE_STATUS = 0

const NO_VALUE = '—'

const ZERO_BYTES = '0B'

/** Whether a request failed rather than completing — a producer-reported error,
 *  or the status 0 that stands in for one. */
export function requestFailed(req: NetworkRequest): boolean {
  return Boolean(req.error) || req.status === TRANSPORT_FAILURE_STATUS
}

/** Bytes a request transferred. A captured 0 (a 204, a HEAD, a body the
 *  collector could not read) is a measured size, where `formatBytes` renders it
 *  as the same dash it gives a size that was never captured at all. */
export function formatTransferSize(size?: number): string {
  return size === 0 ? ZERO_BYTES : formatBytes(size)
}

/** Keyed off `requestFailed` rather than status 0 alone, so the card agrees with
 *  the list column for a request that reported an error before any status. */
function statusCode(req: NetworkRequest): string {
  if (req.status) {
    return String(req.status)
  }
  return requestFailed(req) ? FAILED_STATUS_LABEL : NO_VALUE
}

function formatBody(body: string): string {
  try {
    return JSON.stringify(JSON.parse(body), null, 2)
  } catch {
    return body
  }
}

function kv(key: string, value: unknown, valueClass = ''): TemplateResult {
  return html`
    <div class="kv">
      <span class="k">${key}</span>
      <span class="v ${valueClass}">${value}</span>
    </div>
  `
}

function headersSection(
  title: string,
  headers: Record<string, string> | undefined
) {
  if (!headers || Object.keys(headers).length === 0) {
    return nothing
  }
  return html`
    <div class="detail-section">
      <div class="detail-title">${title}</div>
      <div class="kv-card">
        ${Object.entries(headers).map(([k, v]) => kv(k, v))}
      </div>
    </div>
  `
}

function bodySection(title: string, body: string | undefined) {
  if (!body) {
    return nothing
  }
  return html`
    <div class="detail-section">
      <div class="detail-title">${title}</div>
      <div class="kv-card">
        <div class="kv">
          <span class="v"><pre>${formatBody(body)}</pre></span>
        </div>
      </div>
    </div>
  `
}

function generalSection(req: NetworkRequest) {
  const kind = statusKind(req.status, requestFailed(req))
  return html`
    <div class="detail-section">
      <div class="detail-title">General</div>
      <div class="kv-card">
        ${kv('Request URL', req.url)} ${kv('Method', req.method)}
        ${kv(
          'Status',
          html`${statusCode(req)} ${req.statusText || ''}`,
          `kind-${kind}`
        )}
        ${kv('Type', contentType(req))}
        ${
          typeof req.time === 'number'
            ? kv('Time', formatTime(req.time))
            : nothing
        }
        ${
          typeof req.size === 'number'
            ? kv('Size', formatTransferSize(req.size))
            : nothing
        }
        ${req.error ? kv('Error', req.error, 'kind-error') : nothing}
      </div>
    </div>
  `
}

/** Render the full request detail. `networkStyles` must be in the host's styles. */
export function renderNetworkRequestDetail(
  req: NetworkRequest
): TemplateResult {
  return html`
    <div class="request-detail">
      ${generalSection(req)}
      ${headersSection('Request Headers', req.requestHeaders)}
      ${bodySection('Request Body', req.requestBody)}
      ${headersSection('Response Headers', req.responseHeaders)}
      ${bodySection('Response Body', req.responseBody)}
    </div>
  `
}
