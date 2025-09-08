import { Element } from '@core/element'
import { html, css } from 'lit'
import { customElement, property } from 'lit/decorators.js'

import '~icons/mdi/chevron-right.js'

const SOURCE_COMPONENT = 'wdio-devtools-list'
@customElement(SOURCE_COMPONENT)
export class DevtoolsList extends Element {
  @property({ type: Boolean })
  isCollapsed = false

  @property({ type: String })
  label = ''

  @property({ type: Object })
  list: Record<string, any> | string[] = {}

  static styles = [...Element.styles, css`
    :host {
      display:block;
      width:100%;
    }
    dl {
      width:100%;
    }
    dt {
      font-weight:600;
      font-size:11px;
      letter-spacing:.5px;
      text-transform:uppercase;
      opacity:.75;
      white-space:nowrap;
      overflow:hidden;
      text-overflow:ellipsis;
    }
    pre {
      margin:0;
      font-family: var(--vscode-editor-font-family, monospace);
      font-size:11px;
      line-height:1.25;
      white-space:pre-wrap;
      word-break:break-word;
      overflow-wrap:anywhere;
      background: var(--vscode-editorInlayHint-background, transparent);
      padding:2px 4px;
      border-radius:3px;
      max-height:16rem;
      overflow:auto;
    }
    .row {
      transition: max-height .18s ease;
      box-sizing:border-box;
    }
    .collapse {
      max-height:0 !important;
      overflow:hidden !important;
      padding-top:0 !important;
      padding-bottom:0 !important;
      border-bottom-width:0 !important;
    }
  `]

  #renderMetadataProp(prop: any) {
    if (typeof prop === 'object' && prop !== null) {
      return html`<pre>${JSON.stringify(prop, null, 2)}</pre>`
    }
    return html`<span class="break-words whitespace-pre-wrap">${String(prop)}</span>`
  }

  #toggleCollapseState () {
    this.isCollapsed = !this.isCollapsed
    this.requestUpdate()
  }

  #renderSectionHeader (label: string) {
    return html`
      <button
        @click=${() => this.#toggleCollapseState()}
        class="block w-full border-b-[1px] border-b-panelBorder font-bold flex py-1 px-1">
        <icon-mdi-chevron-right class="text-base transition-transform block ${!this.isCollapsed ? 'block rotate-90' : ''}"></icon-mdi-chevron-right>
        ${label}
      </button>
    `
  }

  render () {
    if (!this.list || Object.keys(this.list).length === 0) {
      return null
    }

    const entries = Array.isArray(this.list)
      ? this.list as string[]
      : Object.entries(this.list)

    return html`
      <section class="block">
        ${this.#renderSectionHeader(this.label)}
        <dl class="flex flex-wrap ${this.isCollapsed ? '' : 'mt-2'}">
          ${entries.map((entry, i) => {
            const isStringEntry = typeof entry === 'string'
            const key = isStringEntry ? undefined : (entry as [string, any])[0]
            const val = isStringEntry ? entry : (entry as [string, any])[1]

            const stringForMeasure = typeof val === 'object' && val !== null
              ? JSON.stringify(val, null, 2)
              : String(val)

            const isMultiline = /\n/.test(stringForMeasure) || stringForMeasure.length > 40 || typeof val === 'object'
            const baseCls = 'row px-2 py-1 border-b-[1px] border-b-panelBorder'
            const colCls = isMultiline ? 'basis-full w-full' : 'basis-1/2'
            const lastBorderFix = i === entries.length - 1 ? '' : ''
            const collapsedCls = this.isCollapsed ? 'collapse' : 'max-h-[500px]'

            if (isStringEntry) {
              return html`
                <dd class="${baseCls} ${colCls} ${collapsedCls} ${lastBorderFix}">
                  ${this.#renderMetadataProp(val)}
                </dd>
              `
            }

            return html`
              <dt class="${baseCls} ${colCls} ${collapsedCls} ${lastBorderFix}">
                ${key}
              </dt>
              <dd class="${baseCls} ${colCls} ${collapsedCls} ${lastBorderFix}">
                ${this.#renderMetadataProp(val)}
              </dd>
            `
          })}
        </dl>
      </section>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    [SOURCE_COMPONENT]: DevtoolsList
  }
}
