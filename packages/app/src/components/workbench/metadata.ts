import { Element } from '@core/element'
import { html, css, nothing, type TemplateResult } from 'lit'
import { customElement } from 'lit/decorators.js'
import { consume } from '@lit/context'

import type { Metadata } from '@wdio/devtools-shared'
import { metadataContext } from '../../controller/context.js'

import '../placeholder.js'
import '~icons/mdi/chevron-right.js'

const SOURCE_COMPONENT = 'wdio-devtools-metadata'
@customElement(SOURCE_COMPONENT)
export class DevtoolsMetadata extends Element {
  @consume({ context: metadataContext, subscribe: true })
  metadata: Partial<Metadata> | undefined = undefined

  /** Section labels the user has collapsed. */
  #collapsed = new Set<string>()

  static styles = [
    ...Element.styles,
    css`
      :host {
        display: flex;
        flex-direction: column;
        width: 100%;
        height: 100%;
        overflow: auto;
      }

      .meta {
        padding: 14px;
        display: flex;
        flex-direction: column;
        gap: 16px;
      }

      .meta-sec h4 {
        display: flex;
        align-items: center;
        gap: 6px;
        margin: 0 0 8px;
        font-size: 12px;
        font-weight: 700;
        color: var(--vscode-foreground);
        cursor: pointer;
        user-select: none;
      }
      .meta-sec .chev {
        color: var(--vscode-descriptionForeground);
        transition: transform 0.15s;
      }
      .meta-sec .chev.open {
        transform: rotate(90deg);
      }

      .meta-card {
        background: var(--vscode-editorWidget-background);
        border: 1px solid var(--vscode-panel-border);
        border-radius: 10px;
        overflow: hidden;
      }

      .mrow {
        display: grid;
        grid-template-columns: minmax(120px, 200px) 1fr;
        gap: 14px;
        padding: 9px 14px;
        font-size: 12px;
        border-top: 1px solid var(--vscode-panel-border);
      }
      .mrow:first-child {
        border-top: none;
      }
      .mrow .k {
        color: var(--vscode-descriptionForeground);
        font-family: var(--vscode-editor-font-family);
        font-size: 11px;
        word-break: break-word;
      }
      .mrow .v {
        color: var(--vscode-foreground);
        font-family: var(--vscode-editor-font-family);
        word-break: break-all;
      }
      .mrow .v a {
        color: var(--accent);
        text-decoration: none;
      }
      .mrow .v a:hover {
        text-decoration: underline;
      }
      .bool-true {
        color: var(--vscode-charts-green);
      }
      .bool-false {
        color: var(--vscode-charts-red);
      }

      /* Object/JSON values get a full-width recessed code block. */
      .mrow.json {
        display: block;
      }
      .mrow.json .k {
        display: block;
        margin-bottom: 8px;
      }
      .mrow.json pre {
        margin: 0;
        background: var(--vscode-editor-background);
        border: 1px solid var(--vscode-panel-border);
        border-radius: 8px;
        padding: 10px 12px;
        font-family: var(--vscode-editor-font-family);
        font-size: 11px;
        line-height: 1.5;
        color: var(--vscode-descriptionForeground);
        overflow: auto;
        white-space: pre-wrap;
        word-break: break-all;
      }
    `
  ]

  #buildSessionInfo(m: MetadataShape): Record<string, unknown> {
    const sessionInfo: Record<string, unknown> = {}
    if (m.sessionId) {
      sessionInfo['Session ID'] = m.sessionId
    }
    if (m.testEnv) {
      sessionInfo.Environment = m.testEnv
    }
    if (m.host) {
      sessionInfo['WebDriver Host'] = m.host
    }
    if (m.modulePath) {
      sessionInfo['Test File'] = m.modulePath
    }
    if (m.url) {
      sessionInfo.URL = m.url
    }
    return sessionInfo
  }

  #toggle(label: string) {
    if (this.#collapsed.has(label)) {
      this.#collapsed.delete(label)
    } else {
      this.#collapsed.add(label)
    }
    this.requestUpdate()
  }

  #renderValue(val: unknown): TemplateResult | string {
    if (typeof val === 'boolean') {
      return html`<span class="bool-${val}">${val}</span>`
    }
    if (typeof val === 'string' && /^https?:\/\//.test(val)) {
      return html`<a href="${val}" target="_blank" rel="noreferrer">${val}</a>`
    }
    return String(val)
  }

  #renderRow(key: string, val: unknown) {
    if (val !== null && typeof val === 'object') {
      return html`
        <div class="mrow json">
          <span class="k">${key}</span>
          <pre>${JSON.stringify(val, null, 2)}</pre>
        </div>
      `
    }
    return html`
      <div class="mrow">
        <span class="k">${key}</span>
        <span class="v">${this.#renderValue(val)}</span>
      </div>
    `
  }

  #renderSection(label: string, data: Record<string, unknown> | undefined) {
    const entries = Object.entries(data ?? {})
    if (entries.length === 0) {
      return nothing
    }
    const open = !this.#collapsed.has(label)
    return html`
      <div class="meta-sec">
        <h4 @click="${() => this.#toggle(label)}">
          <icon-mdi-chevron-right
            class="chev ${open ? 'open' : ''}"
          ></icon-mdi-chevron-right>
          ${label}
        </h4>
        ${open
          ? html`<div class="meta-card">
              ${entries.map(([k, v]) => this.#renderRow(k, v))}
            </div>`
          : nothing}
      </div>
    `
  }

  render() {
    if (!this.metadata) {
      return html`<wdio-devtools-placeholder></wdio-devtools-placeholder>`
    }
    const m = this.metadata as MetadataShape
    return html`
      <div class="meta">
        ${this.#renderSection('Session', this.#buildSessionInfo(m))}
        ${this.#renderSection('Capabilities', m.capabilities)}
        ${this.#renderSection('Desired Capabilities', m.desiredCapabilities)}
        ${this.#renderSection('Options', m.options)}
      </div>
    `
  }
}

interface MetadataShape {
  sessionId?: string
  testEnv?: string
  host?: string
  modulePath?: string
  url?: string
  capabilities?: Record<string, unknown>
  desiredCapabilities?: Record<string, unknown>
  options?: Record<string, unknown>
}

declare global {
  interface HTMLElementTagNameMap {
    [SOURCE_COMPONENT]: DevtoolsMetadata
  }
}
