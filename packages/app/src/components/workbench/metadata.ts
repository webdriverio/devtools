import { Element } from '@core/element'
import { html, css, nothing, type TemplateResult } from 'lit'
import { customElement, state } from 'lit/decorators.js'
import { consume } from '@lit/context'

import type { Metadata, MetadataBySession } from '@wdio/devtools-shared'
import {
  metadataContext,
  metadataBySessionContext
} from '../../controller/context.js'
import { PENDING_SESSION_KEY } from '../../controller/contextUpdates.js'

import '../placeholder.js'
import '~icons/mdi/chevron-right.js'

const SOURCE_COMPONENT = 'wdio-devtools-metadata'
@customElement(SOURCE_COMPONENT)
export class DevtoolsMetadata extends Element {
  /** Latest/active session metadata — fallback when no per-session map exists
   *  (e.g. a loaded single-session trace without a sessionId). */
  @consume({ context: metadataContext, subscribe: true })
  metadata: Partial<Metadata> | undefined = undefined

  @consume({ context: metadataBySessionContext, subscribe: true })
  metadataBySession: MetadataBySession | undefined = undefined

  /** sessionId the user picked in the dropdown; falls back to the latest. */
  @state()
  private selectedSessionId?: string

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

      .session-select {
        align-self: flex-start;
        font-size: 11px;
        font-family: inherit;
        padding: 5px 8px;
        border: 1px solid var(--vscode-panel-border);
        border-radius: 8px;
        background: var(--vscode-input-background);
        color: var(--vscode-foreground);
        cursor: pointer;
        line-height: 1;
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

  #buildSessionInfo(m: Metadata): Record<string, unknown> {
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

  #renderSection(label: string, data: unknown) {
    // Metadata's capability/option bags are typed `unknown` upstream; narrow to
    // a record here so the section can iterate their key/value pairs.
    const entries = Object.entries((data ?? {}) as Record<string, unknown>)
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

  /** Captured sessions in arrival order (the pending buffer is never shown). */
  #sessions(): Array<[string, Metadata]> {
    return Object.entries(this.metadataBySession ?? {}).filter(
      ([id]) => id !== PENDING_SESSION_KEY
    )
  }

  /** Map key of the session to display: the picked one (when still present),
   *  else the latest. Selection is by map key throughout — never the metadata's
   *  `sessionId` field — so the highlighted option and shown content can't drift. */
  #activeKey(sessions: Array<[string, Metadata]>): string | undefined {
    if (
      this.selectedSessionId &&
      sessions.some(([id]) => id === this.selectedSessionId)
    ) {
      return this.selectedSessionId
    }
    return sessions.length ? sessions[sessions.length - 1][0] : undefined
  }

  /** Metadata to display: the active session, else the single active value
   *  (loaded trace with no sessionId). */
  #activeMetadata(sessions: Array<[string, Metadata]>): Metadata | undefined {
    const key = this.#activeKey(sessions)
    const found = key && sessions.find(([id]) => id === key)
    return found ? found[1] : (this.metadata as Metadata | undefined)
  }

  /** Label a session by its index and (when known) its URL host, so the
   *  options are distinguishable — e.g. "Session 2 · www.google.com". */
  #sessionLabel(meta: Metadata, index: number): string {
    let host = ''
    try {
      if (meta.url) {
        host = new URL(meta.url).host
      }
    } catch {
      /* non-URL value — fall back to just the index */
    }
    return host ? `Session ${index + 1} · ${host}` : `Session ${index + 1}`
  }

  #renderSessionSelect(sessions: Array<[string, Metadata]>) {
    if (sessions.length < 2) {
      return nothing
    }
    const selectedKey = this.#activeKey(sessions)
    return html`
      <select
        class="session-select"
        .value=${selectedKey ?? ''}
        @change=${(e: Event) => {
          this.selectedSessionId = (e.target as HTMLSelectElement).value
        }}
      >
        ${sessions.map(
          ([id, meta], i) =>
            html`<option value=${id} ?selected=${id === selectedKey}>
              ${this.#sessionLabel(meta, i)}
            </option>`
        )}
      </select>
    `
  }

  render() {
    const sessions = this.#sessions()
    const active = this.#activeMetadata(sessions)
    if (!active) {
      return html`<wdio-devtools-placeholder></wdio-devtools-placeholder>`
    }
    return html`
      <div class="meta">
        ${this.#renderSessionSelect(sessions)}
        ${this.#renderSection('Session', this.#buildSessionInfo(active))}
        ${this.#renderSection('Capabilities', active.capabilities)}
        ${this.#renderSection(
          'Desired Capabilities',
          active.desiredCapabilities
        )}
        ${this.#renderSection('Options', active.options)}
      </div>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    [SOURCE_COMPONENT]: DevtoolsMetadata
  }
}
