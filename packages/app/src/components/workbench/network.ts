import { Element } from '@core/element'
import { html, css, nothing } from 'lit'
import { customElement, state } from 'lit/decorators.js'
import { consume } from '@lit/context'
import { networkRequestContext } from '../../controller/DataManager.js'

import '../placeholder.js'

const COMPONENT = 'wdio-devtools-network'

function formatBytes(bytes?: number): string {
  if (!bytes || bytes === 0) return '-'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  const size = bytes / Math.pow(k, i)
  return size >= 10 ? `${size.toFixed(0)}${sizes[i]}` : `${size.toFixed(1)}${sizes[i]}`
}

function formatTime(ms?: number): string {
  if (!ms) return '-'
  if (ms < 1) return `${(ms * 1000).toFixed(0)}μs`
  if (ms < 1000) return `${ms.toFixed(0)}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

function getStatusClass(status?: number): string {
  if (!status) return 'text-gray-500'
  if (status >= 200 && status < 300) return 'text-green-500'
  if (status >= 300 && status < 400) return 'text-yellow-500'
  if (status >= 400) return 'text-red-500'
  return 'text-gray-500'
}

function getResourceType(request: NetworkRequest): string {
  const url = request.url.toLowerCase()
  const contentType = request.responseHeaders?.['content-type']?.toLowerCase() || ''

  // Check by content-type first
  if (contentType.includes('text/html')) return 'HTML'
  if (contentType.includes('text/css')) return 'CSS'
  if (contentType.includes('javascript') || contentType.includes('ecmascript')) return 'JS'
  if (contentType.includes('image/')) return 'Image'
  if (contentType.includes('font/') || contentType.includes('woff')) return 'Font'
  if (contentType.includes('application/json')) return 'Fetch'

  // Fallback to URL extension
  if (url.endsWith('.html') || url.endsWith('.htm')) return 'HTML'
  if (url.endsWith('.css')) return 'CSS'
  if (url.endsWith('.js') || url.endsWith('.mjs')) return 'JS'
  if (url.match(/\.(png|jpg|jpeg|gif|svg|webp|ico)$/)) return 'Image'
  if (url.match(/\.(woff|woff2|ttf|eot|otf)$/)) return 'Font'

  // Check by request type
  if (request.type === 'fetch' || request.method !== 'GET') return 'Fetch'

  return 'Other'
}

function getFileName(url: string): string {
  if (!url || url === '' || url === 'event') {
    return '-'
  }

  try {
    const urlObj = new URL(url)
    const pathname = urlObj.pathname
    const parts = pathname.split('/').filter(Boolean)
    const fileName = parts[parts.length - 1]

    // If there's a query string and no filename, show the host + path
    if (!fileName || fileName === '' || pathname === '/') {
      if (urlObj.search) {
        return `${urlObj.hostname}${pathname.length > 1 ? pathname : ''}`
      }
      return urlObj.hostname
    }

    return fileName
  } catch {
    // If URL parsing fails, return a cleaned version
    return url.slice(0, 50)
  }
}

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

  connectedCallback() {
    super.connectedCallback()
    // Watch for visibility changes via active attribute
    const parentTab = this.closest('wdio-devtools-tab')
    if (parentTab) {
      const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
          if (mutation.type === 'attributes' && mutation.attributeName === 'active') {
            // Tab became inactive, clear selection
            if (!parentTab.hasAttribute('active')) {
              this.selectedRequest = undefined
            }
          }
        })
      })
      observer.observe(parentTab, { attributes: true })
      // Store observer to disconnect later
      ;(this as any)._tabObserver = observer
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback()
    // Clean up observer
    if ((this as any)._tabObserver) {
      ;(this as any)._tabObserver.disconnect()
    }
  }

  static styles = [
    ...Element.styles,
    css`
      :host {
        display: flex;
        flex-direction: column;
        height: 100%;
        width: 100%;
        overflow: hidden;
        color: var(--vscode-foreground);
        background-color: var(--vscode-editor-background);
      }

      .network-header {
        padding: 0.5rem 1rem;
        border-bottom: 1px solid var(--vscode-panel-border);
        display: flex;
        gap: 0.5rem;
        align-items: center;
        flex-shrink: 0;
      }

      .search-input {
        padding: 0.375rem 0.75rem;
        border: 1px solid var(--vscode-panel-border);
        background: var(--vscode-input-background);
        color: var(--vscode-input-foreground);
        border-radius: 4px;
        font-size: 0.875rem;
        min-width: 200px;
      }

      .search-input:focus {
        outline: none;
        border-color: var(--vscode-focusBorder);
      }

      .filter-tabs {
        display: flex;
        gap: 0.25rem;
        margin-left: 1rem;
      }

      .filter-tab {
        padding: 0.375rem 0.75rem;
        border: none;
        background: transparent;
        color: var(--vscode-foreground);
        cursor: pointer;
        font-size: 0.875rem;
        transition: all 0.15s;
        border-bottom: 2px solid transparent;
      }

      .filter-tab:hover {
        background: var(--vscode-toolbar-hoverBackground);
      }

      .filter-tab.active {
        color: var(--vscode-textLink-activeForeground);
        border-bottom-color: var(--vscode-textLink-activeForeground);
      }

      .network-content {
        display: flex;
        flex: 1;
        overflow: hidden;
      }

      .requests-list {
        flex: 1;
        overflow-y: auto;
        overflow-x: auto;
        border-right: 1px solid var(--vscode-panel-border);
        min-width: 0;
      }

      .requests-header {
        display: grid;
        grid-template-columns: 200px 80px 70px 180px 90px 80px 90px;
        min-width: 790px;
        border-bottom: 1px solid var(--vscode-panel-border);
        font-size: 0.75rem;
        font-weight: 600;
        color: var(--vscode-descriptionForeground);
        position: sticky;
        top: 0;
        background: var(--vscode-editor-background);
        z-index: 1;
      }

      .requests-header > div {
        padding: 0.5rem;
        border-right: 1px solid var(--vscode-panel-border);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .requests-header > div:last-child {
        border-right: none;
      }

      .request-row {
        display: grid;
        grid-template-columns: 200px 80px 70px 180px 90px 80px 90px;
        min-width: 790px;
        border-bottom: 1px solid var(--vscode-panel-border);
        cursor: pointer;
        font-size: 0.875rem;
        transition: background 0.15s;
        align-items: center;
      }

      .request-row > span {
        padding: 0.5rem;
        border-right: 1px solid var(--vscode-panel-border);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .request-row > span:last-child {
        border-right: none;
      }

      .request-row:hover {
        background: var(--vscode-list-hoverBackground);
      }

      .request-row.selected {
        background: var(--vscode-list-activeSelectionBackground);
        color: var(--vscode-list-activeSelectionForeground);
      }

      .request-row.error {
        color: var(--vscode-errorForeground);
      }

      .request-detail {
        flex: 1;
        overflow-y: auto;
        padding: 1rem;
        min-width: 400px;
      }

      .detail-section {
        margin-bottom: 1.5rem;
      }

      .detail-title {
        font-size: 0.875rem;
        font-weight: 600;
        margin-bottom: 0.5rem;
        color: var(--vscode-foreground);
      }

      .detail-content {
        background: var(--vscode-editor-background);
        padding: 0.75rem;
        border-radius: 4px;
        border: 1px solid var(--vscode-panel-border);
        font-family: monospace;
        font-size: 0.75rem;
        overflow-x: auto;
      }

      .header-row {
        display: flex;
        gap: 1rem;
        padding: 0.25rem 0;
        border-bottom: 1px solid var(--vscode-panel-border);
      }

      .header-key {
        font-weight: 600;
        color: var(--vscode-symbolIcon-keyForeground);
        flex-shrink: 0;
        min-width: 80px;
      }

      .header-value {
        color: var(--vscode-symbolIcon-stringForeground);
        word-break: break-word;
        flex: 1;
        text-align: right;
      }

      .truncate {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .text-muted {
        color: var(--vscode-descriptionForeground);
      }
    `
  ]

  #filterRequests(): NetworkRequest[] {
    let filtered = this.networkRequests

    // Filter by resource type
    if (this.filterType !== 'All') {
      filtered = filtered.filter((req) => getResourceType(req) === this.filterType)
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
    const resourceTypes = ['All', 'Fetch', 'HTML', 'JS', 'CSS', 'Font', 'Image']

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
          ${resourceTypes.map(
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
                      >${request.responseHeaders?.['content-type']?.split(';')[0] || '-'}</span
                    >
                    <span>${formatTime(request.time)}</span>
                    <span>${formatBytes(request.size)}</span>
                    <span class="text-muted"
                      >${request.startTime ? `${request.startTime.toFixed(1)}s` : '-'}</span
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
                    <span class="header-value text-red-500"
                      >${req.error}</span
                    >
                  </div>
                `
              : nothing}
          </div>
        </div>

        ${req.requestHeaders &&
        Object.keys(req.requestHeaders).length > 0
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
        ${req.responseHeaders &&
        Object.keys(req.responseHeaders).length > 0
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
