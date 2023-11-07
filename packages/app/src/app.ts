import { css, html, nothing } from 'lit'
import { provide } from '@lit/context'
import { customElement, query, property } from 'lit/decorators.js'
import { type TraceLog } from '@devtools/hook/types'

import { Element } from '@core/element'
import { context } from './context.js'
import { DragController, Direction } from './utils/DragController.js'

import './components/header.js'
import './components/sidebar.js'
import './components/workbench.js'
import './components/onboarding/start.js'

const SIDEBAR_MIN_WIDTH = 200
const CACHE_ID = 'wdio-trace-cache'

let cachedTraceFile: TraceLog | undefined
  try {
  const localStorageValue = localStorage.getItem(CACHE_ID)
  cachedTraceFile = localStorageValue ? JSON.parse(localStorageValue) : undefined
} catch (e: unknown) {
  console.warn(`Failed to parse cached trace file: ${(e as Error).message}`)
}

@customElement('wdio-devtools')
export class WebdriverIODevtoolsApplication extends Element {
  @provide({ context })
  @property({ type: Object })
  data: TraceLog = cachedTraceFile!

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
      <wdio-devtools-header></wdio-devtools-header>
      ${this.#mainContent()}
    `
  }

  #mainContent () {
    if (!this.data) {
      return html`<wdio-devtools-start .onLoad=${(data: TraceLog) => {
        this.data = data
        localStorage.setItem(CACHE_ID, JSON.stringify(data))
        this.requestUpdate()
      }}></wdio-devtools-start>`
    }

    return html`
      <section class="flex h-[calc(100%-40px)] w-full relative">
        ${
          // only render sidebar if trace file is captured using testrunner
          this.data?.metadata.type === 'standalone'
            ? html`<wdio-devtools-sidebar style="${this.#drag.getPosition()}"></wdio-devtools-sidebar>`
            : nothing
        }

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
