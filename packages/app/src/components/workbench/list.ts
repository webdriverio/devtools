import { Element } from '@core/element'
import { html } from 'lit'
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
  list: Record<string, any> = {}

  #renderMetadataProp(prop: any) {
    if (typeof prop === 'object') {
      return html`<pre class="w-[100px]">${JSON.stringify(prop, null, 2)}</pre>`
    }

    return html`<span class="break-all">${prop}</span>`
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

    const entries = Object.entries(this.list)
    return html`
      <section class="block">
        ${this.#renderSectionHeader(this.label)}
        <dl class="flex flex-wrap transition-all ${this.isCollapsed ? 'mt-0' : 'mt-2'}">
          ${entries.map(([key, val], i) => {
            let className = 'basis-2/4 transition-all border-b-panelBorder overflow-y-hidden'
            if (i === (entries.length - 1)) {
              className += this.isCollapsed ? ' pb-0' : ' pb-2'
              if (!this.isCollapsed) {
                className += ' border-b-[1px]'
              }
            }
            className += this.isCollapsed ? ' max-h-0' : ' max-h-[500px]'
            return html`
              <dt class="${className} font-bold px-2">${key}</dt>
              <dd class="${className}">${this.#renderMetadataProp(val)}</dd>
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
