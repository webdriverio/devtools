import { Element } from '@core/element'
import { html, css } from 'lit'
import { customElement } from 'lit/decorators.js'
import { consume } from '@lit/context'

import type { Metadata } from '@wdio/devtools-shared'
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

  #renderListIfNonEmpty(label: string, list: Record<string, unknown>) {
    return Object.keys(list).length
      ? html`<wdio-devtools-list
          label="${label}"
          .list="${list}"
        ></wdio-devtools-list>`
      : ''
  }

  render() {
    if (!this.metadata) {
      return html`<wdio-devtools-placeholder></wdio-devtools-placeholder>`
    }
    const m = this.metadata as MetadataShape
    return html`
      ${this.#renderListIfNonEmpty('Session', this.#buildSessionInfo(m))}
      <wdio-devtools-list
        label="Capabilities"
        .list="${m.capabilities || {}}"
      ></wdio-devtools-list>
      ${this.#renderListIfNonEmpty(
        'Desired Capabilities',
        m.desiredCapabilities || {}
      )}
      ${this.#renderListIfNonEmpty('Options', m.options || {})}
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
