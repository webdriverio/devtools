import { css, html } from 'lit'
import { customElement } from 'lit/decorators.js'

import { Element } from '@core/element'

import './components/header.js'
import './components/sidebar.js'
import './components/content.js'

@customElement('wdio-devtools')
export class WebdriverIODevtoolsApplication extends Element {
  static styles = [...Element.styles, css`
    :host {
      display: flex;
      width: 100%;
      height: 100vh;
      flex-wrap: wrap;
    }
  `]

  render() {
    return html`
      <wdio-devtools-header></wdio-devtools-header>
      <section class="flex h-full w-full">
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
