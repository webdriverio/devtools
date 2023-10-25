import { css, html } from 'lit'
import { styleMap } from 'lit/directives/style-map.js'
import { customElement, query } from 'lit/decorators.js'

import { Element } from '@core/element'

import { DragController } from './utils/DragController.js'

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
    initialPosition: {
      x: window.innerWidth * .2 // initial width of sidebase is 20% of window
    },
    getContainerEl: () => this.#getWindow(),
    getDraggableEl: () => this.#getDraggableEl(),
    getIsDraggable: () => true,
  })

  async #getDraggableEl() {
    await this.updateComplete
    return this.resizer as Element
  }

  @query('wdio-devtools-sidebar')
    sidebar?: HTMLElement

  @query('button')
    resizer?: HTMLElement

  @query('section')
    window?: HTMLElement

  async #getWindow() {
    await this.updateComplete
    return this.window as Element
  }

  render() {
    return html`
      <wdio-devtools-header></wdio-devtools-header>
      <section class="flex h-full w-full relative">
        <wdio-devtools-sidebar style="flex-basis: ${Math.max(this.#drag.x, SIDEBAR_MIN_WIDTH)}px"></wdio-devtools-sidebar>
        <wdio-devtools-workbench class="basis-auto"></wdio-devtools-workbench>
        <button
          data-dragging=${this.#drag.state}
          style=${styleMap({ left: `${Math.max(this.#drag.x, SIDEBAR_MIN_WIDTH) - 5}px` })}
          class="cursor-col-resize absolute top-0 h-full w-[10px]"></button>
      </section>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'wdio-devtools': WebdriverIODevtoolsApplication
  }
}
