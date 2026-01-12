import { Element } from '@core/element'
import { html, css, nothing } from 'lit'
import { customElement } from 'lit/decorators.js'
import { consume } from '@lit/context'

import { consoleLogContext } from '../../controller/DataManager.js'

const LOG_ICONS: Record<ConsoleLogs['type'], string> = {
  log: '📄',
  info: 'ℹ️',
  warn: '⚠️',
  error: '❌'
}

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

      .console-container {
        flex: 1;
        overflow-y: auto;
        font-family:
          'SF Mono', Monaco, 'Cascadia Code', 'Roboto Mono', Consolas,
          'Courier New', monospace;
        font-size: 13px;
        line-height: 1.6;
      }

      .log-entry {
        display: flex;
        align-items: flex-start;
        padding: 2px 8px;
        border-bottom: 1px solid rgba(128, 128, 128, 0.05);
        min-height: 22px;
      }

      .log-entry:hover {
        background-color: rgba(255, 255, 255, 0.02);
      }

      .log-entry.log-type-error {
        background-color: rgba(244, 135, 113, 0.03);
      }

      .log-entry.log-type-warn {
        background-color: rgba(205, 151, 49, 0.03);
      }

      .log-entry.log-type-info {
        background-color: rgba(14, 99, 156, 0.03);
      }

      .log-time,
      .log-icon {
        flex-shrink: 0;
      }

      .log-time {
        width: 45px;
        text-align: right;
        margin-right: 12px;
        font-size: 11px;
        opacity: 0.5;
        user-select: none;
        color: var(--vscode-editorLineNumber-foreground);
        line-height: 18px;
      }

      .log-icon {
        margin-right: 8px;
        font-size: 14px;
        line-height: 18px;
      }

      .log-prefix {
        flex-shrink: 0;
        color: var(--vscode-foreground);
        opacity: 0.8;
        margin-right: 4px;
      }

      .log-content {
        flex: 1;
        min-width: 0;
        word-break: break-word;
        line-height: 18px;
        display: flex;
        align-items: baseline;
      }

      .log-message {
        color: var(--vscode-foreground);
        white-space: pre-wrap;
        word-break: break-word;
      }

      .log-entry.log-type-error .log-message {
        color: #f48771;
      }

      .log-entry.log-type-warn .log-message {
        color: #cd9731;
      }

      .log-entry.log-type-info .log-message {
        color: #75beff;
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

  #formatArgs(args: any[]): string {
    if (Array.isArray(args)) {
      return args
        .map((arg) => {
          if (typeof arg === 'string') {
            return arg
          }
          try {
            return JSON.stringify(arg, null, 2)
          } catch {
            return String(arg)
          }
        })
        .join(' ')
    }
    return String(args)
  }

  render() {
    if (!this.logs || this.logs.length === 0) {
      return html`
        <div class="empty-state">
          <div class="empty-state-icon">📋</div>
          <div class="empty-state-text">No console logs captured yet</div>
        </div>
      `
    }

    if (this.logs.length === 0) {
      return html`
        <div class="empty-state">
          <div class="empty-state-icon">📋</div>
          <div class="empty-state-text">No console logs captured yet</div>
        </div>
      `
    }

    return html`
      <div class="console-container">
        ${this.logs.map((log: any) => {
          const icon = LOG_ICONS[log.type] || LOG_ICONS.log
          return html`
            <div class="log-entry log-type-${log.type || 'log'}">
              ${log.timestamp
                ? html`<div class="log-time">
                    ${this.#formatElapsedTime(log.timestamp)}
                  </div>`
                : nothing}
              <div class="log-icon">${icon}</div>
              <div class="log-content">
                ${log.source === 'test'
                  ? html`<span class="log-prefix">>>></span>`
                  : nothing}
                <span class="log-message">${this.#formatArgs(log.args)}</span>
              </div>
            </div>
          `
        })}
      </div>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    [SOURCE_COMPONENT]: DevtoolsConsoleLogs
  }
}
