import { Element } from '@core/element'
import { html, css } from 'lit'
import { customElement } from 'lit/decorators.js'
import { consume } from '@lit/context'

import type { Metadata } from '@wdio/devtools-service/types'
import { metadataContext } from '../../controller/context.js'

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

    const m = this.metadata as any
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

    const caps = m.capabilities || {}
    const desiredCaps = m.desiredCapabilities || {}

    return html`
      ${Object.keys(sessionInfo).length
        ? html`<wdio-devtools-list
            label="Session"
            .list="${sessionInfo}"
          ></wdio-devtools-list>`
        : ''}
      <wdio-devtools-list
        label="Capabilities"
        .list="${caps}"
      ></wdio-devtools-list>
      ${Object.keys(desiredCaps).length
        ? html`<wdio-devtools-list
            label="Desired Capabilities"
            .list="${desiredCaps}"
          ></wdio-devtools-list>`
        : ''}
      ${m.options && Object.keys(m.options).length
        ? html`<wdio-devtools-list
            label="Options"
            .list="${m.options}"
          ></wdio-devtools-list>`
        : ''}
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    [SOURCE_COMPONENT]: DevtoolsMetadata
  }
}
