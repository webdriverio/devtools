import { Element } from '@core/element'
import { html, css } from 'lit'
import { customElement } from 'lit/decorators.js'
import { consume } from '@lit/context'

import { metadataContext, type Metadata } from '../../controller/DataManager.js'

import './list.js'
import '../placeholder.js'
import '~icons/mdi/chevron-right.js'

const SOURCE_COMPONENT = 'wdio-devtools-metadata'
@customElement(SOURCE_COMPONENT)
export class DevtoolsMetadata extends Element {
  @consume({ context: metadataContext, subscribe: true })
  metadata: Partial<Metadata> | undefined = undefined

  static styles = [
    ...Element.styles,
    css`
      :host {
        display: flex;
        flex-direction: column;
        width: 100%;
        height: 100%;
        font-size: 0.8em;
      }
    `
  ]

  render() {
    if (!this.metadata) {
      return html`<wdio-devtools-placeholder></wdio-devtools-placeholder>`
    }

    const { url } = this.metadata
    return html`
      <wdio-devtools-list
        label="Metadata"
        .list="${{ url }}"
      ></wdio-devtools-list>
      <wdio-devtools-list
        label="Capabilities"
        .list="${this.metadata.capabilities}"
      ></wdio-devtools-list>
      <wdio-devtools-list
        label="Options"
        .list="${this.metadata.options}"
      ></wdio-devtools-list>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    [SOURCE_COMPONENT]: DevtoolsMetadata
  }
}
