import { Element } from '@core/element'
import type { NetworkRequest } from '@wdio/devtools-shared'
import { html, nothing } from 'lit'
import { networkStyles } from './network/styles.js'
import { customElement, state } from 'lit/decorators.js'
import { consume } from '@lit/context'
import { networkRequestContext } from '../../controller/context.js'
import {
  FAILED_STATUS_LABEL,
  RESOURCE_TYPES,
  TYPE_DOT_CLASS,
  type ResourceFilter
} from '../../utils/network-constants.js'
import {
  formatTime,
  statusKind,
  getResourceType,
  getFileName,
  contentType
} from '../../utils/network-helpers.js'

import {
  networkWindow,
  waterfallBar,
  type WaterfallScale
} from './network/waterfall.js'
import {
  formatTransferSize,
  renderNetworkRequestDetail,
  requestFailed
} from './network/request-detail.js'

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
  filterType: ResourceFilter = 'All'

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

  #renderRequestRow(request: NetworkRequest, range: WaterfallScale) {
    const kind = statusKind(request.status, requestFailed(request))
    const dotClass = TYPE_DOT_CLASS[getResourceType(request)]
    // A zero duration is a measurement (a cached or same-tick response), so the
    // cell reports it; only the bar is held back, because a zero-width bar draws
    // as a stray sliver rather than as a duration.
    const duration = typeof request.time === 'number' ? request.time : undefined
    const hasBar = duration !== undefined && duration > 0
    const bar = waterfallBar(request, range)
    // A transport failure is captured as status 0, which is not a code — it reads
    // as ERR so a dead request is never mistaken for one still in flight, which
    // is what the dash means.
    const statusLabel =
      request.status || (requestFailed(request) ? FAILED_STATUS_LABEL : '—')
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
          ${statusLabel}
        </span>
        <span class="req-type truncate" title="${contentType(request)}"
          >${contentType(request)}</span
        >
        <span class="req-wf">
          <span class="wf-track">
            ${hasBar
              ? html`<span
                  class="wf-bar kind-${kind}"
                  style="left:${bar.offset}%;width:${bar.width}%"
                ></span>`
              : nothing}
          </span>
        </span>
        <span class="req-dur ${duration === undefined ? 'req-dur-empty' : ''}"
          >${duration === undefined ? '—' : formatTime(duration)}</span
        >
        <span class="req-size">${formatTransferSize(request.size)}</span>
      </div>
    `
  }

  render() {
    if (!this.networkRequests || this.networkRequests.length === 0) {
      return html`
        <wdio-devtools-placeholder
          icon="🌐"
          heading="No network requests captured"
          description="Network requests will appear here as your tests run"
        ></wdio-devtools-placeholder>
      `
    }
    const filteredRequests = this.#filterRequests()
    const range = networkWindow(filteredRequests)
    return html`
      ${this.#renderNetworkHeader()}
      <div class="network-content">
        <div class="requests-list">
          <div class="grid requests-header">
            <div>Name</div>
            <div>Method</div>
            <div>Status</div>
            <div>Type</div>
            <div>Waterfall</div>
            <div class="col-num">Duration</div>
            <div class="col-num">Size</div>
          </div>
          ${filteredRequests.length === 0
            ? html`<div class="filter-empty">
                No requests match your filter
              </div>`
            : filteredRequests.map((r) => this.#renderRequestRow(r, range))}
        </div>
        ${this.selectedRequest
          ? renderNetworkRequestDetail(this.selectedRequest)
          : nothing}
      </div>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    [COMPONENT]: DevtoolsNetwork
  }
}
