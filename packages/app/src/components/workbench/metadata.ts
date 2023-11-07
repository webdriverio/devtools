import { Element } from '@core/element'
import { html, css } from 'lit'
import { customElement } from 'lit/decorators.js'
import { consume } from '@lit/context'

import { context, type TraceLog } from '../../context.js'

import '~icons/mdi/chevron-right.js'

const SOURCE_COMPONENT = 'wdio-devtools-metadata'
@customElement(SOURCE_COMPONENT)
export class DevtoolsMetadata extends Element {
  @consume({ context })
  data: TraceLog = {} as TraceLog

  static styles = [...Element.styles, css`
    :host {
      display: flex;
      flex-direction: column;
      width: 100%;
      height: 100%;
      font-size: .8em;
    }
  `]

  #renderMetadataProp(prop: any) {
    if (typeof prop === 'object') {
      return html`<pre class="w-[100px]">${JSON.stringify(prop, null, 2)}</pre>`
    }

    return prop
  }

  #renderSectionHeader (label: string) {
    return html`
      <h1 class="text-l border-y-[1px] border-y-panelBorder font-bold flex py-1 px-1">
        <icon-mdi-chevron-right class="text-base block w-[15px]"></icon-mdi-chevron-right>
        ${label}
      </h1>
    `
  }

  #renderList(label: string, list: Record<string, any>) {
    return html`
      <section class="block">
        ${this.#renderSectionHeader(label)}
        <dl class="flex flex-wrap">
          ${Object.entries(list).map(([key, val]) => html`
            <dt class="w-[50%] font-bold px-2">${key}</dt>
            <dd class="w-[50%]">${this.#renderMetadataProp(val)}</dd>
          `)}
        </dl>
      </section>
    `

  }

  render() {
    const { id, url } = this.data.metadata
    return html`
      ${this.#renderList('Metadata', { id, url })}
      ${this.#renderList('Capabilities', this.data.metadata.capabilities)}
      ${this.#renderList('Options', this.data.metadata.options)}
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    [SOURCE_COMPONENT]: DevtoolsMetadata
  }
}
