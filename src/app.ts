import { css, html } from 'lit'
import { styleMap } from 'lit/directives/style-map.js'
import { customElement, query } from 'lit/decorators.js'

import { Element } from '@core/element'

import { DragController } from './utils/DragController.js'

import './components/header.js'
import './components/sidebar.js'
import './components/workbench.js'

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

  #drag = new DragController(this, {
    initialPosition: {
      x: window.innerHeight * .2 // initial width of sidebase is 20% of window
    },
    getContainerEl: () => this.window as Element,
    getDraggableEl: () => this.#getDraggableEl(),
    getIsDraggable: () => true,
  })

  async #getDraggableEl() {
    await this.updateComplete;
    return this.resizer as Element
  }

  @query('wdio-devtools-sidebar')
  sidebar?: HTMLElement

  @query('button')
  resizer?: HTMLElement

  @query('section')
  window?: HTMLElement

  render() {
    return html`
      <wdio-devtools-header></wdio-devtools-header>
      <section class="flex h-full w-full relative">
        <wdio-devtools-sidebar style="width: ${this.#drag.x}px"></wdio-devtools-sidebar>
        <wdio-devtools-workbench></wdio-devtools-workbench>
        <button
          data-dragging=${this.#drag.state}
          style=${styleMap({ left: `${this.#drag.x - 5}px` })}
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
