import { Element } from '@core/element'
import { html, css, nothing, type TemplateResult } from 'lit'
import { customElement, property } from 'lit/decorators.js'

import type { CommandLog } from '@wdio/devtools-shared'
import type { CommandEndpoint } from '@wdio/protocols'

import { commandCategory } from './actionItems/category.js'
import { formatDuration } from './actionItems/duration.js'

const SOURCE_COMPONENT = 'wdio-devtools-logs'
@customElement(SOURCE_COMPONENT)
export class DevtoolsCommandLogs extends Element {
  #commandDefinition?: CommandEndpoint

  @property({ type: Object })
  command?: CommandLog

  @property({ type: Number })
  elapsedTime?: number

  static styles = [
    ...Element.styles,
    css`
      :host {
        display: flex;
        flex-direction: column;
        width: 100%;
        height: 100%;
        min-height: 0;
        color: var(--vscode-foreground);
      }

      .cmd-empty {
        flex: 1;
        display: grid;
        place-items: center;
        color: var(--vscode-descriptionForeground);
        font-size: 13px;
      }

      .cmd-head {
        flex: none;
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 12px 14px;
        border-bottom: 1px solid var(--vscode-panel-border);
      }
      .cat-dot {
        width: 9px;
        height: 9px;
        border-radius: 3px;
        flex: none;
      }
      .cat-navigation {
        background: var(--vscode-charts-blue);
      }
      .cat-input {
        background: var(--vscode-charts-purple);
      }
      .cat-assertion {
        background: var(--vscode-charts-green);
      }
      .cat-query {
        background: var(--vscode-charts-yellow);
      }
      .cat-other {
        background: var(--vscode-descriptionForeground);
      }
      .cmd-name {
        font-family: var(--vscode-editor-font-family);
        font-weight: 700;
        font-size: 14px;
      }
      .cmd-dur {
        font-family: var(--vscode-editor-font-family);
        font-size: 11px;
        color: var(--vscode-editorLineNumber-foreground);
      }
      .cmd-ref {
        margin-left: auto;
        font-size: 12px;
        color: var(--accent);
        text-decoration: none;
      }
      .cmd-ref:hover {
        text-decoration: underline;
      }

      .cmd-body {
        flex: 1;
        overflow: auto;
        padding: 14px;
        display: flex;
        flex-direction: column;
        gap: 16px;
      }
      .dsec > h4 {
        font-size: 10.5px;
        letter-spacing: 0.6px;
        text-transform: uppercase;
        color: var(--vscode-descriptionForeground);
        margin-bottom: 8px;
      }
      .cmd-desc {
        font-size: 12.5px;
        color: var(--vscode-descriptionForeground);
        line-height: 1.65;
      }

      .kv-card {
        background: var(--vscode-editorWidget-background);
        border: 1px solid var(--vscode-panel-border);
        border-radius: 10px;
        overflow: hidden;
      }
      .kv {
        display: grid;
        grid-template-columns: minmax(80px, auto) 1fr;
        gap: 14px;
        padding: 9px 14px;
        font-size: 12px;
        border-top: 1px solid var(--vscode-panel-border);
      }
      .kv:first-child {
        border-top: none;
      }
      .kv .k {
        color: var(--vscode-descriptionForeground);
        font-family: var(--vscode-editor-font-family);
        white-space: nowrap;
      }
      .kv .v {
        color: var(--vscode-foreground);
        font-family: var(--vscode-editor-font-family);
        word-break: break-all;
        text-align: right;
      }
      .kv .v.empty {
        color: var(--vscode-editorLineNumber-foreground);
      }
    `
  ]

  connectedCallback(): void {
    super.connectedCallback()
    window.addEventListener('show-command', async (ev: CustomEvent) => {
      const command = ev.detail.command
      this.elapsedTime = ev.detail.elapsedTime

      const {
        WebDriverProtocol,
        MJsonWProtocol,
        AppiumProtocol,
        ChromiumProtocol,
        SauceLabsProtocol,
        SeleniumProtocol,
        GeckoProtocol,
        WebDriverBidiProtocol
      } = await import('@wdio/protocols')
      const endpoints = Object.values({
        ...WebDriverProtocol,
        ...MJsonWProtocol,
        ...AppiumProtocol,
        ...ChromiumProtocol,
        ...SauceLabsProtocol,
        ...SeleniumProtocol,
        ...GeckoProtocol,
        ...WebDriverBidiProtocol
      }).reduce(
        (acc, endpoint) => {
          for (const cmdDesc of Object.values(endpoint)) {
            acc[cmdDesc.command] = cmdDesc as CommandEndpoint
          }
          return acc
        },
        {} as Record<string, CommandEndpoint>
      )
      this.#commandDefinition = endpoints[command.command]
      this.command = command

      // Source line-tracking is dispatched by the Actions handler; here we only
      // surface the command's detail in the Log tab.
      this.closest('wdio-devtools-tabs')?.activateTab('Log')
    })
  }

  #stringify(value: unknown): string {
    if (typeof value === 'string') {
      return value
    }
    try {
      return JSON.stringify(value, null, 2)
    } catch {
      return String(value)
    }
  }

  #renderKvCard(rows: Array<[string, unknown]>): TemplateResult {
    return html`
      <div class="kv-card">
        ${rows.map(([key, value]) => {
          const isEmpty = value === null || value === undefined
          return html`<div class="kv">
            <span class="k">${key}</span>
            <span class="v ${isEmpty ? 'empty' : ''}"
              >${isEmpty ? 'null' : this.#stringify(value)}</span
            >
          </div>`
        })}
      </div>
    `
  }

  #renderParameters() {
    const args = this.command!.args || []
    if (args.length === 0) {
      return nothing
    }
    const rows = args.map((val, i): [string, unknown] => [
      String(this.#commandDefinition?.parameters?.[i]?.name ?? i),
      val
    ])
    return html`
      <div class="dsec">
        <h4>Parameters</h4>
        ${this.#renderKvCard(rows)}
      </div>
    `
  }

  #renderResult() {
    const result = this.command!.result
    if (result === null || result === undefined) {
      return nothing
    }
    const rows: Array<[string, unknown]> =
      typeof result === 'object' ? Object.entries(result) : [['value', result]]
    return html`
      <div class="dsec">
        <h4>Result</h4>
        ${this.#renderKvCard(rows)}
      </div>
    `
  }

  render() {
    if (!this.command) {
      return html`<div class="cmd-empty">
        Select a command to view its details
      </div>`
    }
    const category = commandCategory(this.command.command)
    const definition = this.#commandDefinition
    return html`
      <div class="cmd-head">
        <span class="cat-dot cat-${category}"></span>
        <span class="cmd-name">${this.command.command}</span>
        ${this.elapsedTime !== undefined
          ? html`<span class="cmd-dur"
              >${formatDuration(this.elapsedTime)}</span
            >`
          : nothing}
        ${definition
          ? html`<a class="cmd-ref" href="${definition.ref}" target="_blank"
              >Reference ↗</a
            >`
          : nothing}
      </div>
      <div class="cmd-body">
        ${definition?.description
          ? html`<div class="dsec">
              <h4>Description</h4>
              <div class="cmd-desc">${definition.description}</div>
            </div>`
          : nothing}
        ${this.#renderParameters()} ${this.#renderResult()}
      </div>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    [SOURCE_COMPONENT]: DevtoolsCommandLogs
  }
}
