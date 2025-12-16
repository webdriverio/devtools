import { css, html, nothing } from 'lit'
import { customElement, query } from 'lit/decorators.js'
import { TraceType, type TraceLog } from '@wdio/devtools-service/types'

import { Element } from '@core/element'
import { DataManagerController } from './controller/DataManager.js'
import { DragController, Direction } from './utils/DragController.js'

import './components/header.js'
import './components/sidebar.js'
import './components/workbench.js'
import './components/onboarding/start.js'

const SIDEBAR_MIN_WIDTH = 250

@customElement('wdio-devtools')
export class WebdriverIODevtoolsApplication extends Element {
  dataManager = new DataManagerController(this)

  static styles = [
    ...Element.styles,
    css`
      :host {
        display: flex;
        width: 100%;
        height: 100vh;
        flex-wrap: wrap;
        overflow: hidden;
      }
    `
  ]

  #drag = new DragController(this, {
    localStorageKey: 'sidebarWidth',
    minPosition: SIDEBAR_MIN_WIDTH,
    initialPosition: window.innerWidth * 0.2,
    getContainerEl: () => this.#getWindow(),
    direction: Direction.horizontal
  })

  @query('section')
  window?: HTMLElement

  @query('section[data-resizer-window]')
  resizerWindow?: HTMLElement

  async #getWindow() {
    await this.updateComplete
    return this.resizerWindow as Element
  }

  connectedCallback(): void {
    super.connectedCallback()
    window.addEventListener('load-trace', this.#loadTrace.bind(this))
    this.addEventListener(
      'clear-execution-data',
      this.#clearExecutionData.bind(this)
    )
  }

  render() {
    return html`
      <wdio-devtools-header></wdio-devtools-header>
      ${this.#mainContent()}
    `
  }

  #loadTrace({ detail }: { detail: TraceLog }) {
    this.dataManager.loadTraceFile(detail)
    this.requestUpdate()
  }

  #clearExecutionData({ detail }: { detail?: { uid?: string } }) {
    this.dataManager.clearExecutionData(detail?.uid)
  }

  #mainContent() {
    if (!this.dataManager.hasConnection) {
      return html`<wdio-devtools-start></wdio-devtools-start>`
    }

    return html`
      <section
        data-resizer-window
        class="flex h-[calc(100%-40px)] w-full relative"
      >
        ${
          // only render sidebar if trace file is captured using testrunner
          this.dataManager.traceType === TraceType.Testrunner
            ? html`<wdio-devtools-sidebar
                style="${this.#drag?.getPosition()}"
              ></wdio-devtools-sidebar>`
            : nothing
        }
        ${this.#drag.getSlider('z-10 h-full')}
        <wdio-devtools-workbench class="basis-auto"></wdio-devtools-workbench>
      </section>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'wdio-devtools': WebdriverIODevtoolsApplication
  }
}
