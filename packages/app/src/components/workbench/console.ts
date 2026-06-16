import { Element } from '@core/element'
import { html, css } from 'lit'
import { customElement, state } from 'lit/decorators.js'
import { consume } from '@lit/context'

import { consoleLogContext } from '../../controller/context.js'
import { LOG_ICONS, CONSOLE_SOURCE_BADGE } from '../../controller/constants.js'
import {
  filterConsoleLogs,
  formatConsoleArgs,
  type ConsoleLevelFilter
} from './console-filter.js'

const LEVEL_FILTERS: ReadonlyArray<{ key: ConsoleLevelFilter; label: string }> =
  [
    { key: 'all', label: 'All' },
    { key: 'error', label: 'Errors' },
    { key: 'warn', label: 'Warnings' },
    { key: 'info', label: 'Info' },
    { key: 'log', label: 'Logs' }
  ]

const SOURCE_COMPONENT = 'wdio-devtools-console-logs'
@customElement(SOURCE_COMPONENT)
export class DevtoolsConsoleLogs extends Element {
  static styles = [
    ...Element.styles,
    css`
      :host {
        display: flex;
        flex: 1;
        flex-direction: column;
        background-color: var(--vscode-editor-background);
        min-height: 0;
        position: relative;
      }

      /* ── Toolbar: filter input + segmented level filter ── */
      .console-header {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 10px 14px;
        flex-shrink: 0;
      }
      .search-input {
        flex: 1;
        max-width: 280px;
        padding: 6px 10px;
        border: 1px solid var(--vscode-panel-border);
        background: var(--vscode-input-background);
        color: var(--vscode-foreground);
        border-radius: 8px;
        font-size: 12px;
      }
      .search-input::placeholder {
        color: var(--vscode-descriptionForeground);
      }
      .search-input:focus {
        outline: none;
        border-color: var(--accent);
      }
      .filter-tabs {
        display: flex;
        gap: 2px;
        padding: 2px;
        border: 1px solid var(--vscode-panel-border);
        border-radius: 8px;
        background: var(--vscode-input-background);
      }
      .filter-tab {
        border: none;
        background: transparent;
        color: var(--vscode-descriptionForeground);
        cursor: pointer;
        font-size: 11px;
        font-weight: 600;
        padding: 4px 10px;
        border-radius: 6px;
        transition:
          background-color 0.15s ease,
          color 0.15s ease;
      }
      .filter-tab:hover {
        color: var(--vscode-foreground);
      }
      .filter-tab.active {
        background: var(--accent);
        color: var(--accent-foreground);
      }

      /* ── Log list ── */
      .console-container {
        flex: 1;
        overflow-y: auto;
        font-family: var(--vscode-editor-font-family);
        font-size: 12px;
        padding: 4px 0;
      }

      .log-entry {
        display: grid;
        grid-template-columns: 46px 16px auto 1fr;
        align-items: start;
        gap: 10px;
        padding: 4px 14px;
        border-bottom: 1px solid var(--vscode-panel-border);
        line-height: 1.55;
      }
      .log-entry:hover {
        background-color: var(--vscode-list-hoverBackground);
      }
      .log-entry.log-type-error {
        background-color: color-mix(
          in srgb,
          var(--vscode-charts-red) 6%,
          transparent
        );
      }
      .log-entry.log-type-warn {
        background-color: color-mix(
          in srgb,
          var(--vscode-charts-yellow) 6%,
          transparent
        );
      }

      .log-time {
        text-align: right;
        font-size: 10.5px;
        color: var(--vscode-editorLineNumber-foreground);
        font-variant-numeric: tabular-nums;
        user-select: none;
      }
      .log-icon {
        text-align: center;
        line-height: 1.55;
        color: var(--vscode-descriptionForeground);
      }
      .log-entry.log-type-error .log-icon,
      .log-entry.log-type-error .log-message {
        color: var(--vscode-charts-red);
      }
      .log-entry.log-type-warn .log-icon,
      .log-entry.log-type-warn .log-message {
        color: var(--vscode-charts-yellow);
      }
      .log-entry.log-type-info .log-icon {
        color: var(--vscode-charts-blue);
      }

      .log-badge {
        justify-self: start;
        font-size: 9.5px;
        line-height: 1.55;
        font-weight: 700;
        letter-spacing: 0.4px;
        padding: 2px 6px;
        border-radius: 5px;
      }
      .b-test {
        color: var(--vscode-charts-green);
        background: color-mix(
          in srgb,
          var(--vscode-charts-green) 14%,
          transparent
        );
      }
      .b-runner {
        color: var(--accent);
        background: color-mix(in srgb, var(--accent) 14%, transparent);
      }
      .b-browser {
        color: var(--vscode-charts-blue);
        background: color-mix(
          in srgb,
          var(--vscode-charts-blue) 14%,
          transparent
        );
      }

      .log-message {
        color: var(--vscode-foreground);
        white-space: pre-wrap;
        word-break: break-word;
      }

      .empty-state {
        position: absolute;
        inset: 0;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 12px;
        color: var(--vscode-descriptionForeground);
      }
      .empty-state-icon {
        font-size: 48px;
        opacity: 0.3;
      }
      .empty-state-text {
        font-size: 14px;
        opacity: 0.6;
      }
    `
  ]

  @consume({ context: consoleLogContext, subscribe: true })
  logs: ConsoleLogs[] | undefined = undefined

  @state()
  private searchText = ''

  @state()
  private activeLevel: ConsoleLevelFilter = 'all'

  get logCount(): number {
    return this.logs?.length || 0
  }

  #startTime?: number

  #formatElapsedTime(timestamp: number): string {
    if (this.#startTime === undefined) {
      this.#startTime = this.logs?.[0]?.timestamp ?? timestamp
    }
    const elapsed = (timestamp - this.#startTime!) / 1000
    return `${elapsed.toFixed(1)}s`
  }

  #renderToolbar() {
    return html`
      <div class="console-header">
        <input
          class="search-input"
          type="text"
          placeholder="Filter logs"
          .value=${this.searchText}
          @input=${(e: Event) => {
            this.searchText = (e.target as HTMLInputElement).value
          }}
        />
        <div class="filter-tabs">
          ${LEVEL_FILTERS.map(
            ({ key, label }) => html`
              <button
                class="filter-tab ${this.activeLevel === key ? 'active' : ''}"
                @click=${() => {
                  this.activeLevel = key
                }}
              >
                ${label}
              </button>
            `
          )}
        </div>
      </div>
    `
  }

  #renderEmptyState() {
    return html`
      <div class="empty-state">
        <div class="empty-state-icon">📋</div>
        <div class="empty-state-text">No console logs captured yet</div>
      </div>
    `
  }

  #renderLogEntry(log: ConsoleLogs) {
    const icon = LOG_ICONS[log.type] || LOG_ICONS.log
    const badge = log.source ? CONSOLE_SOURCE_BADGE[log.source] : undefined
    return html`
      <div class="log-entry log-type-${log.type || 'log'}">
        <div class="log-time">
          ${log.timestamp ? this.#formatElapsedTime(log.timestamp) : ''}
        </div>
        <div class="log-icon">${icon}</div>
        ${badge
          ? html`<span class="log-badge ${badge.class}">${badge.label}</span>`
          : html`<span></span>`}
        <span class="log-message">${formatConsoleArgs(log.args)}</span>
      </div>
    `
  }

  render() {
    if (!this.logs || this.logs.length === 0) {
      return this.#renderEmptyState()
    }
    const visible = filterConsoleLogs(
      this.logs,
      this.activeLevel,
      this.searchText
    )
    return html`
      ${this.#renderToolbar()}
      <div class="console-container">
        ${visible.length
          ? visible.map((log) => this.#renderLogEntry(log))
          : html`<div class="empty-state-text" style="padding: 16px 14px">
              No logs match the current filter.
            </div>`}
      </div>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    [SOURCE_COMPONENT]: DevtoolsConsoleLogs
  }
}
