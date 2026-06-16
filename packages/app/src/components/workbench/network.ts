import { Element } from '@core/element'
import { html, nothing } from 'lit'
import { networkStyles } from './network/styles.js'
import { customElement, state } from 'lit/decorators.js'
import { consume } from '@lit/context'
import { networkRequestContext } from '../../controller/context.js'
import {
  RESOURCE_TYPES,
  TYPE_DOT_CLASS
} from '../../utils/network-constants.js'
import {
  formatBytes,
  formatTime,
  statusKind,
  getResourceType,
  getFileName,
  contentType
} from '../../utils/network-helpers.js'

import '../placeholder.js'

const COMPONENT = 'wdio-devtools-network'

@customElement(COMPONENT)
export class DevtoolsNetwork extends Element {
  @consume({ context: networkRequestContext, subscribe: true })
  @state()
  networkRequests: NetworkRequest[] = []

  @state()
  selectedRequest?: NetworkRequest

  @state()
  filterType: string = 'All'

  @state()
  searchQuery: string = ''

  private _tabObserver?: MutationObserver

  connectedCallback() {
    super.connectedCallback()
    // Watch for visibility changes via active attribute
    const parentTab = this.closest('wdio-devtools-tab')
    if (parentTab) {
      const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
          if (
            mutation.type === 'attributes' &&
            mutation.attributeName === 'active'
          ) {
            // Tab became inactive, clear selection
            if (!parentTab.hasAttribute('active')) {
              this.selectedRequest = undefined
            }
          }
        })
      })
      observer.observe(parentTab, { attributes: true })
      this._tabObserver = observer
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback()
    // Clean up observer
    if (this._tabObserver) {
      this._tabObserver.disconnect()
    }
  }

  static styles = [...Element.styles, networkStyles]

  #filterRequests(): NetworkRequest[] {
    let filtered = this.networkRequests

    // Filter by resource type
    if (this.filterType !== 'All') {
      filtered = filtered.filter(
        (req) => getResourceType(req) === this.filterType
      )
    }

    // Filter by search query
    if (this.searchQuery) {
      const query = this.searchQuery.toLowerCase()
      filtered = filtered.filter(
        (req) =>
          req.url.toLowerCase().includes(query) ||
          req.method.toLowerCase().includes(query) ||
          req.status?.toString().includes(query) ||
          getFileName(req.url).toLowerCase().includes(query)
      )
    }

    return filtered
  }

  #selectRequest(request: NetworkRequest) {
    // Clicking the already-selected row again closes the detail panel.
    this.selectedRequest =
      this.selectedRequest?.id === request.id ? undefined : request
  }

  #renderNetworkHeader() {
    return html`
      <div class="network-header">
        <input
          type="text"
          class="search-input"
          placeholder="Filter network"
          .value="${this.searchQuery}"
          @input="${(e: InputEvent) =>
            (this.searchQuery = (e.target as HTMLInputElement).value)}"
        />
        <div class="filter-tabs">
          ${RESOURCE_TYPES.map(
            (type) => html`
              <button
                class="filter-tab ${this.filterType === type ? 'active' : ''}"
                @click="${() => (this.filterType = type)}"
              >
                ${type}
              </button>
            `
          )}
        </div>
      </div>
    `
  }

  #renderRequestRow(request: NetworkRequest) {
    const kind = statusKind(request.status, Boolean(request.error))
    const dotClass = TYPE_DOT_CLASS[getResourceType(request)]
    return html`
      <div
        class="grid request-row ${this.selectedRequest?.id === request.id
          ? 'selected'
          : ''}"
        @click="${() => this.#selectRequest(request)}"
      >
        <span class="req-name">
          <i class="type-dot ${dotClass}"></i>
          <span class="truncate" title="${request.url}"
            >${getFileName(request.url)}</span
          >
        </span>
        <span class="req-method">${request.method}</span>
        <span class="req-status kind-${kind}">
          <i class="status-dot"></i>
          ${request.status || (request.error ? 'ERR' : '—')}
        </span>
        <span class="req-type truncate" title="${contentType(request)}"
          >${contentType(request)}</span
        >
        <span class="req-dur">${formatTime(request.time)}</span>
        <span class="req-size">${formatBytes(request.size)}</span>
      </div>
    `
  }

  render() {
    if (!this.networkRequests || this.networkRequests.length === 0) {
      return html`
        <wdio-devtools-placeholder
          icon="network"
          title="No network requests captured"
          description="Network requests will appear here as your tests run"
        ></wdio-devtools-placeholder>
      `
    }
    const filteredRequests = this.#filterRequests()
    return html`
      ${this.#renderNetworkHeader()}
      <div class="network-content">
        <div class="requests-list">
          <div class="grid requests-header">
            <div>Name</div>
            <div>Method</div>
            <div>Status</div>
            <div>Type</div>
            <div class="col-num">Duration</div>
            <div class="col-num">Size</div>
          </div>
          ${filteredRequests.length === 0
            ? html`<div class="filter-empty">
                No requests match your filter
              </div>`
            : filteredRequests.map((r) => this.#renderRequestRow(r))}
        </div>
        ${this.selectedRequest ? this.#renderRequestDetail() : nothing}
      </div>
    `
  }

  #renderKv(key: string, value: unknown, valueClass = '') {
    return html`
      <div class="kv">
        <span class="k">${key}</span>
        <span class="v ${valueClass}">${value}</span>
      </div>
    `
  }

  #renderHeadersSection(
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
          ${Object.entries(headers).map(([k, v]) => this.#renderKv(k, v))}
        </div>
      </div>
    `
  }

  #renderBodySection(title: string, body: string | undefined) {
    if (!body) {
      return nothing
    }
    return html`
      <div class="detail-section">
        <div class="detail-title">${title}</div>
        <div class="kv-card">
          <div class="kv">
            <span class="v"><pre>${this.#formatBody(body)}</pre></span>
          </div>
        </div>
      </div>
    `
  }

  #renderGeneralSection(req: NetworkRequest) {
    const kind = statusKind(req.status, Boolean(req.error))
    return html`
      <div class="detail-section">
        <div class="detail-title">General</div>
        <div class="kv-card">
          ${this.#renderKv('Request URL', req.url)}
          ${this.#renderKv('Method', req.method)}
          ${this.#renderKv(
            'Status',
            html`${req.status || '—'} ${req.statusText || ''}`,
            `kind-${kind}`
          )}
          ${this.#renderKv('Type', contentType(req))}
          ${req.time ? this.#renderKv('Time', formatTime(req.time)) : nothing}
          ${req.size ? this.#renderKv('Size', formatBytes(req.size)) : nothing}
          ${req.error
            ? this.#renderKv('Error', req.error, 'kind-error')
            : nothing}
        </div>
      </div>
    `
  }

  #renderRequestDetail() {
    const req = this.selectedRequest!
    return html`
      <div class="request-detail">
        ${this.#renderGeneralSection(req)}
        ${this.#renderHeadersSection('Request Headers', req.requestHeaders)}
        ${this.#renderBodySection('Request Body', req.requestBody)}
        ${this.#renderHeadersSection('Response Headers', req.responseHeaders)}
        ${this.#renderBodySection('Response Body', req.responseBody)}
      </div>
    `
  }

  #formatBody(body: string): string {
    try {
      const parsed = JSON.parse(body)
      return JSON.stringify(parsed, null, 2)
    } catch {
      return body
    }
  }
}

declare global {
  interface HTMLElementTagNameMap {
    [COMPONENT]: DevtoolsNetwork
  }
}
