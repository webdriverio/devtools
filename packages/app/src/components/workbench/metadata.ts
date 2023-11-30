import { Element } from '@core/element'
import { html, css } from 'lit'
import { customElement } from 'lit/decorators.js'
import { consume } from '@lit/context'

import { context, type TraceLog } from '../../context.js'

import './list.js'
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

  render() {
    const { url } = this.data.metadata
    return html`
      <wdio-devtools-list
        label="Metadata"
        .list="${({ url })}"></wdio-devtools-list>
      <wdio-devtools-list
        label="Capabilities"
        .list="${this.data.metadata.capabilities}"></wdio-devtools-list>
      <wdio-devtools-list
        label="Options"
        .list="${this.data.metadata.options}"></wdio-devtools-list>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    [SOURCE_COMPONENT]: DevtoolsMetadata
  }
}
