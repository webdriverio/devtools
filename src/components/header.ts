import { Element } from '@core/element'
import { html, css } from 'lit'
import { customElement } from 'lit/decorators.js'

import '~icons/custom/logo.svg'
import '~icons/mdi/white-balance-sunny'
import '~icons/mdi/moon-waning-crescent'

@customElement('wdio-devtools-header')
export class DevtoolsHeader extends Element {
  #darkMode = window.matchMedia('(prefers-color-scheme: dark)').matches

  constructor() {
    super()
    if (this.#darkMode) {
      document.querySelector('body')?.classList.add('dark')
    }
  }

  static styles = [...Element.styles, css`
    :host {
      display: flex;
      align-items: center;
      background: black;
      height: 40px;
      width: 100%;
    }
  `]

  render() {
    return html`
      <icon-custom-logo class="p-2 dark:p-2 h-full"></icon-custom-logo>
      <h1 class="font-bold text-white">WebdriverIO Devtools</h1>
      <nav class="ml-auto mr-2">
        <button class="p-2" @click="${this.#switchMode}">
          <icon-mdi-moon-waning-crescent class="${this.#darkMode ? 'hidden' : 'show'}"></icon-mdi-moon-waning-crescent>
          <icon-mdi-white-balance-sunny class="${this.#darkMode ? 'show' : 'hidden'}"></icon-mdi-white-balance-sunny>
        </button>
      </nav>
    `
  }

  #switchMode() {
    const body = document.querySelector('body')
    body?.classList.toggle('dark')
    this.#darkMode = !this.#darkMode
    this.requestUpdate()
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'wdio-devtools-header': DevtoolsHeader
  }
}
