import { Element } from '@core/element'
import { html, css } from 'lit'
import { styleMap } from 'lit/directives/style-map.js'
import { customElement, query } from 'lit/decorators.js'

import { DragController } from '../utils/DragController.js'

import './tabs.js'
import './workbench/source.js'
import './browser/snapshot.js'

const MIN_WORKBENCH_HEIGHT = 600
const MIN_METATAB_WIDTH = 250

const COMPONENT = 'wdio-devtools-workbench'
@customElement(COMPONENT)
export class DevtoolsWorkbench extends Element {
  static styles = [...Element.styles, css`
    :host {
      display: flex;
      flex-direction: column;
      flex-grow: 1;
      height: 100%;
      color: var(--vscode-foreground);
      background-color: var(--vscode-editor-background);
      justify-content: center;
      align-items: center;
      position: relative;
    }
  `]

  #dragVertical = new DragController(this, {
    initialPosition: {
      y: window.innerHeight * .7 // initial height of sidebase is 20% of window
    },
    getContainerEl: () => this.getShadowRootAsync() as any as Element,
    getDraggableEl: () => this.#getVerticalDraggableEl(),
    getIsDraggable: () => true,
    horizontal: false
  })

  #dragHorizontal = new DragController(this, {
    initialPosition: {
      x: MIN_METATAB_WIDTH // initial height of sidebase is 20% of window
    },
    getContainerEl: () => this.#getHorizontalWindow(),
    getDraggableEl: () => this.#getHorizontalDraggableEl(),
    getIsDraggable: () => true,
    vertical: false
  })

  async #getVerticalDraggableEl() {
    await this.updateComplete
    return this.verticalResizer as Element
  }

  @query('button[data-vertical-resizer]')
  verticalResizer?: HTMLElement

  async #getHorizontalDraggableEl() {
    await this.updateComplete
    return this.horizontalResizer as Element
  }

  @query('button[data-horizontal-resizer]')
  horizontalResizer?: HTMLElement

  async #getHorizontalWindow() {
    await this.updateComplete
    return this.horizontalResizerWindow as Element
  }

  @query('section[data-horizontal-resizer-window]')
  horizontalResizerWindow?: HTMLElement

  @query('wdio-devtools-browser')
  browser?: HTMLElement

  async firstUpdated() {
    // Give the browser a chance to paint
    await new Promise((r) => setTimeout(r, 0))
    this.addEventListener('window-drag', () => {
      if (!this.browser) {
        return
      }
      this.browser.dispatchEvent(new Event('window-drag', { bubbles: false }))
    }, true)
  }

  render() {
    return html`
      <section data-horizontal-resizer-window class="flex h-[70%] w-full" style="flex-basis: ${Math.max(this.#dragVertical.y, MIN_WORKBENCH_HEIGHT)}px">
        <section style="flex-basis: ${Math.max(this.#dragHorizontal.x, MIN_METATAB_WIDTH)}px">
          <wdio-devtools-tabs class="h-full flex flex-col border-r-[1px] border-r-panelBorder">
            <wdio-devtools-tab label="Actions">
              Actions tab not yet implemented!
            </wdio-devtools-tab>
            <wdio-devtools-tab label="Metadata">
              Metadata tab not yet implemented!
            </wdio-devtools-tab>
          </wdio-devtools-tabs>
        </section>
        <section class="basis-auto text-gray-500 flex items-center justify-center flex-grow">
          <wdio-devtools-browser></wdio-devtools-browser>
        </section>
        <button
          data-horizontal-resizer
          data-dragging=${this.#dragHorizontal.state}
          style=${styleMap({ left: `${Math.max(this.#dragHorizontal.x, MIN_METATAB_WIDTH) - 5}px` })}
          class="cursor-col-resize bg-red absolute bg-red top-0 h-full w-[10px] z-10"></button>
      </section>
      <wdio-devtools-tabs class="border-t-[1px] border-t-panelBorder">
        <wdio-devtools-tab label="Source">
          <wdio-devtools-source></wdio-devtools-source>
        </wdio-devtools-tab>
        <wdio-devtools-tab label="Log">
          Log tab not yet implemented!
        </wdio-devtools-tab>
        <wdio-devtools-tab label="Console">
          Console tab not yet implemented!
        </wdio-devtools-tab>
        <wdio-devtools-tab label="Network">
          Network tab not yet implemented!
        </wdio-devtools-tab>
      </wdio-devtools-tabs>
      <button
        data-vertical-resizer
        data-dragging=${this.#dragVertical.state}
        style=${styleMap({ top: `${Math.max(this.#dragVertical.y, MIN_WORKBENCH_HEIGHT) - 5}px` })}
        class="cursor-row-resize absolute bg-red top-0 w-full h-[10px] z-10"></button>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    [COMPONENT]: DevtoolsWorkbench;
  }
}
