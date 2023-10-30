import { Element } from '@core/element'
import { html, css, nothing } from 'lit'
import { customElement, query } from 'lit/decorators.js'

import { DragController, Direction } from '../utils/DragController.js'

import '~icons/mdi/arrow-collapse-down.js'
import '~icons/mdi/arrow-collapse-up.js'
import '~icons/mdi/arrow-collapse-left.js'
import '~icons/mdi/arrow-collapse-right.js'

import './tabs.js'
import './workbench/source.js'
import './workbench/actions.js'
import './browser/snapshot.js'

const MIN_WORKBENCH_HEIGHT = 600
const MIN_METATAB_WIDTH = 250
const RERENDER_TIMEOUT = 10

const COMPONENT = 'wdio-devtools-workbench'
@customElement(COMPONENT)
export class DevtoolsWorkbench extends Element {
  #toolbarCollapsed = localStorage.getItem('toolbarCollapsed') === 'true'
  #workbenchSidebarCollapsed = localStorage.getItem('workbenchSidebarCollapsed') === 'true'

  static styles = [...Element.styles, css`
    :host {
      display: flex;
      flex-direction: column;
      flex-grow: 1;
      color: var(--vscode-foreground);
      background-color: var(--vscode-editor-background);
      position: relative;
    }
  `]

  #dragVertical = new DragController(this, {
    localStorageKey: 'toolbarHeight',
    minPosition: MIN_WORKBENCH_HEIGHT,
    initialPosition: window.innerHeight * .7, // initial height of sidebase is 20% of window
    getContainerEl: () => this.getShadowRootAsync() as any as Element,
    direction: Direction.vertical
  })

  #dragHorizontal = new DragController(this, {
    localStorageKey: 'workbenchSidebarWidth',
    minPosition: MIN_METATAB_WIDTH,
    initialPosition: MIN_METATAB_WIDTH, // initial height of sidebase is 20% of window
    getContainerEl: () => this.#getHorizontalWindow(),
    direction: Direction.horizontal
  })

  async #getHorizontalWindow() {
    await this.updateComplete
    return this.horizontalResizerWindow as Element
  }

  #toggle (key: 'toolbar' | 'workbenchSidebar') {
    if (key === 'toolbar') {
      this.#toolbarCollapsed = !this.#toolbarCollapsed
      localStorage.setItem(key, `${this.#toolbarCollapsed}`)
    } else if (key === 'workbenchSidebar') {
      this.#workbenchSidebarCollapsed = !this.#workbenchSidebarCollapsed
      localStorage.setItem(key, `${this.#workbenchSidebarCollapsed}`)
    } else {
      return console.warn(`Unknown key: "${key}"`)
    }

    this.requestUpdate()

    /**
     * send drag event to make iframe rerender it's size
     */
    setTimeout(() => window.dispatchEvent(new CustomEvent('window-drag', {
      bubbles: true,
      composed: true
    })), RERENDER_TIMEOUT)
  }

  @query('section[data-horizontal-resizer-window]')
  horizontalResizerWindow?: HTMLElement

  render() {
    const heightWorkbench = this.#toolbarCollapsed ? '' : 'h-[70%]'
    const styleWorkbench = this.#toolbarCollapsed ? '' : this.#dragVertical.getPosition()
    return html`
      <section data-horizontal-resizer-window class="flex w-full ${heightWorkbench} flex-1" style="${styleWorkbench}">
        <section style="${!this.#workbenchSidebarCollapsed ? this.#dragHorizontal.getPosition() : ''}">
          ${!this.#workbenchSidebarCollapsed ?
            html`
              <wdio-devtools-tabs class="h-full flex flex-col border-r-[1px] border-r-panelBorder">
                <wdio-devtools-tab label="Actions">
                  <wdio-devtools-actions></wdio-devtools-actions>
                </wdio-devtools-tab>
                <wdio-devtools-tab label="Metadata">
                  Metadata tab not yet implemented!
                </wdio-devtools-tab>
                <nav class="ml-auto" slot="actions">
                  <button @click="${() => this.#toggle('workbenchSidebar')}" class="flex h-10 w-10 items-center justify-center pointer ml-auto hover:bg-toolbarHoverBackground">
                    <icon-mdi-arrow-collapse-left></icon-mdi-arrow-collapse-left>
                  </button>
                </nav>
              </wdio-devtools-tabs>
            ` :
            html`
              <button
                @click="${() => this.#toggle('workbenchSidebar')}"
                class="absolute top-0 left-0 bg-sideBarBackground flex h-10 w-10 items-center justify-center cursor-pointer rounded-br-md hover:bg-toolbarHoverBackground">
                <icon-mdi-arrow-collapse-right></icon-mdi-arrow-collapse-right>
              </button>
            `
          }
        </section>
        <section class="basis-auto text-gray-500 flex items-center justify-center flex-grow">
          <wdio-devtools-browser></wdio-devtools-browser>
        </section>
        ${!this.#workbenchSidebarCollapsed ? this.#dragHorizontal.getSlider() : nothing}
      </section>
      ${!this.#toolbarCollapsed ?
        html`
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
            <nav class="ml-auto" slot="actions">
              <button @click="${() => this.#toggle('toolbar')}" class="flex h-10 w-10 items-center justify-center pointer ml-auto hover:bg-toolbarHoverBackground">
                <icon-mdi-arrow-collapse-down></icon-mdi-arrow-collapse-down>
              </button>
            </nav>
          </wdio-devtools-tabs>
        ` :
        html`
          <button
            @click="${() => this.#toggle('toolbar')}"
            class="absolute right-0 bottom-0 bg-sideBarBackground flex h-10 w-10 items-center justify-center cursor-pointer rounded-tl-md hover:bg-toolbarHoverBackground">
            <icon-mdi-arrow-collapse-up></icon-mdi-arrow-collapse-up>
          </button>
        `
      }
      ${!this.#toolbarCollapsed ? this.#dragVertical.getSlider() : nothing}
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    [COMPONENT]: DevtoolsWorkbench;
  }
}
