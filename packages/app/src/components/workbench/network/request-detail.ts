// Shared request-detail block (General + request/response headers + bodies).
// Reused by the live Network panel (DevtoolsNetwork) and the trace-player's
// network drawer (TraceTimeline). The returned markup relies on `networkStyles`
// being present in the host component's shadow root.

import { html, nothing, type TemplateResult } from 'lit'
import {
  formatBytes,
  formatTime,
  statusKind,
  contentType
} from '../../../utils/network-helpers.js'

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
  const kind = statusKind(req.status, Boolean(req.error))
  return html`
    <div class="detail-section">
      <div class="detail-title">General</div>
      <div class="kv-card">
        ${kv('Request URL', req.url)} ${kv('Method', req.method)}
        ${kv(
          'Status',
          html`${req.status || '—'} ${req.statusText || ''}`,
          `kind-${kind}`
        )}
        ${kv('Type', contentType(req))}
        ${req.time ? kv('Time', formatTime(req.time)) : nothing}
        ${req.size ? kv('Size', formatBytes(req.size)) : nothing}
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
