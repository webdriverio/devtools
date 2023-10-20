import { css, html } from 'lit'
import { customElement } from 'lit/decorators.js'

import { Element } from '@core/element'

import './components/header.js'
import './components/sidebar.js'
import './components/content.js'

/**
 * An example element.
 *
 * @slot - This element has a slot
 * @csspart button - The button
 */
@customElement('wdio-devtools')
export class WebdriverIODevtoolsApplication extends Element {
  static styles = [...Element.styles, css`
    :host {
      width: 100%;
      height: 100%;
    }
  `]

  render() {
    return html`
      <wdio-devtools-header></wdio-devtools-header>
      <section class="flex">
        <wdio-devtools-sidebar></wdio-devtools-sidebar>
        <wdio-devtools-content></wdio-devtools-content>
      </section>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'wdio-devtools': WebdriverIODevtoolsApplication
  }
}
