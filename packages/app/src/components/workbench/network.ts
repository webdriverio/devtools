import { Element } from '@core/element'
import { html, nothing } from 'lit'
import { networkStyles } from './network/styles.js'
import { customElement, state } from 'lit/decorators.js'
import { consume } from '@lit/context'
import { networkRequestContext } from '../../controller/context.js'
import { RESOURCE_TYPES } from '../../utils/network-constants.js'
import {
  formatBytes,
  formatTime,
  getStatusClass,
  getResourceType,
  getFileName
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
    this.selectedRequest = request
  }

  render() {
    const filteredRequests = this.#filterRequests()

    if (!this.networkRequests || this.networkRequests.length === 0) {
      return html`
        <wdio-devtools-placeholder
          icon="network"
          title="No network requests captured"
          description="Network requests will appear here as your tests run"
        ></wdio-devtools-placeholder>
      `
    }

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
      <div class="network-content">
        <div class="requests-list">
          <div class="requests-header">
            <div>Name</div>
            <div>Method</div>
            <div>Status</div>
            <div>Content Type</div>
            <div>Duration</div>
            <div>Size</div>
            <div>Start</div>
          </div>
          ${filteredRequests.length === 0
            ? html`
                <div class="p-4 text-center text-sm text-muted">
                  No requests match your filter
                </div>
              `
            : filteredRequests.map(
                (request) => html`
                  <div
                    class="request-row ${this.selectedRequest?.id === request.id
                      ? 'selected'
                      : ''} ${request.error ? 'error' : ''}"
                    @click="${() => this.#selectRequest(request)}"
                  >
                    <span class="truncate" title="${request.url}"
                      >${getFileName(request.url)}</span
                    >
                    <span>${request.method}</span>
                    <span class="${getStatusClass(request.status)}"
                      >${request.status || (request.error ? 'ERR' : '-')}</span
                    >
                    <span class="truncate text-muted"
                      >${request.responseHeaders?.['content-type']?.split(
                        ';'
                      )[0] || '-'}</span
                    >
                    <span>${formatTime(request.time)}</span>
                    <span>${formatBytes(request.size)}</span>
                    <span class="text-muted"
                      >${request.startTime
                        ? `${request.startTime.toFixed(1)}s`
                        : '-'}</span
                    >
                  </div>
                `
              )}
        </div>
        ${this.selectedRequest ? this.#renderRequestDetail() : nothing}
      </div>
    `
  }

  #renderRequestDetail() {
    const req = this.selectedRequest!

    return html`
      <div class="request-detail">
        <div class="detail-section">
          <div class="detail-title">General</div>
          <div class="detail-content">
            <div class="header-row">
              <span class="header-key">URL:</span>
              <span class="header-value">${req.url}</span>
            </div>
            <div class="header-row">
              <span class="header-key">Method:</span>
              <span class="header-value">${req.method}</span>
            </div>
            <div class="header-row">
              <span class="header-key">Status:</span>
              <span class="header-value ${getStatusClass(req.status)}"
                >${req.status || '-'} ${req.statusText || ''}</span
              >
            </div>
            <div class="header-row">
              <span class="header-key">Type:</span>
              <span class="header-value">${req.type}</span>
            </div>
            ${req.time
              ? html`
                  <div class="header-row">
                    <span class="header-key">Time:</span>
                    <span class="header-value">${formatTime(req.time)}</span>
                  </div>
                `
              : nothing}
            ${req.size
              ? html`
                  <div class="header-row">
                    <span class="header-key">Size:</span>
                    <span class="header-value">${formatBytes(req.size)}</span>
                  </div>
                `
              : nothing}
            ${req.error
              ? html`
                  <div class="header-row">
                    <span class="header-key">Error:</span>
                    <span class="header-value text-red-500">${req.error}</span>
                  </div>
                `
              : nothing}
          </div>
        </div>

        ${req.requestHeaders && Object.keys(req.requestHeaders).length > 0
          ? html`
              <div class="detail-section">
                <div class="detail-title">Request Headers</div>
                <div class="detail-content">
                  ${Object.entries(req.requestHeaders).map(
                    ([key, value]) => html`
                      <div class="header-row">
                        <span class="header-key">${key}:</span>
                        <span class="header-value">${value}</span>
                      </div>
                    `
                  )}
                </div>
              </div>
            `
          : nothing}
        ${req.requestBody
          ? html`
              <div class="detail-section">
                <div class="detail-title">Request Body</div>
                <div class="detail-content">
                  <pre>${this.#formatBody(req.requestBody)}</pre>
                </div>
              </div>
            `
          : nothing}
        ${req.responseHeaders && Object.keys(req.responseHeaders).length > 0
          ? html`
              <div class="detail-section">
                <div class="detail-title">Response Headers</div>
                <div class="detail-content">
                  ${Object.entries(req.responseHeaders).map(
                    ([key, value]) => html`
                      <div class="header-row">
                        <span class="header-key">${key}:</span>
                        <span class="header-value">${value}</span>
                      </div>
                    `
                  )}
                </div>
              </div>
            `
          : nothing}
        ${req.responseBody
          ? html`
              <div class="detail-section">
                <div class="detail-title">Response Body</div>
                <div class="detail-content">
                  <pre>${this.#formatBody(req.responseBody)}</pre>
                </div>
              </div>
            `
          : nothing}
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
