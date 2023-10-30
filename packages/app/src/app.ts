import { css, html } from 'lit'
import { customElement, query } from 'lit/decorators.js'

import { Element } from '@core/element'

import { DragController, Direction } from './utils/DragController.js'

import './components/header.js'
import './components/sidebar.js'
import './components/workbench.js'

const SIDEBAR_MIN_WIDTH = 200

@customElement('wdio-devtools')
export class WebdriverIODevtoolsApplication extends Element {
  static styles = [...Element.styles, css`
    :host {
      display: flex;
      width: 100%;
      height: 100vh;
      flex-wrap: wrap;
      overflow: hidden;
    }
  `]

  #drag = new DragController(this, {
    localStorageKey: 'sidebarWidth',
    minPosition: SIDEBAR_MIN_WIDTH,
    initialPosition: window.innerWidth * .2,
    getContainerEl: () => this.#getWindow(),
    direction: Direction.horizontal
  })

  @query('section')
  window?: HTMLElement

  async #getWindow() {
    await this.updateComplete
    return this.window as Element
  }

  render() {
    return html`
      <wdio-devtools-header class="h-[5%]"></wdio-devtools-header>
      <section class="flex h-[95%] w-full relative">
        <wdio-devtools-sidebar style="${this.#drag.getPosition()}"></wdio-devtools-sidebar>
        <wdio-devtools-workbench class="basis-auto"></wdio-devtools-workbench>
        ${this.#drag.getSlider()}
      </section>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'wdio-devtools': WebdriverIODevtoolsApplication
  }
}
