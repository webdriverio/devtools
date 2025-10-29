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
import './workbench/logs.js'
import './workbench/console.js'
import './workbench/metadata.js'
import './browser/snapshot.js'

const MIN_WORKBENCH_HEIGHT = Math.min(300, window.innerHeight * 0.3)
const MIN_METATAB_WIDTH = 260
const RERENDER_TIMEOUT = 10

const COMPONENT = 'wdio-devtools-workbench'
@customElement(COMPONENT)
export class DevtoolsWorkbench extends Element {
  #toolbarCollapsed = localStorage.getItem('toolbar') === 'true'
  #workbenchSidebarCollapsed =
    localStorage.getItem('workbenchSidebar') === 'true'

  static styles = [
    ...Element.styles,
    css`
      :host {
        display: flex;
        flex-direction: column;
        flex-grow: 1;
        height: 100vh;
        min-height: 0;
        overflow: hidden;
        color: var(--vscode-foreground);
        background-color: var(--vscode-editor-background);
        position: relative;
      }
    `
  ]

  #dragVertical = new DragController(this, {
    localStorageKey: 'toolbarHeight',
    minPosition: MIN_WORKBENCH_HEIGHT,
    maxPosition: window.innerHeight * 0.7,
    initialPosition: window.innerHeight * 0.7, // initial height of browser window is 70% of window
    getContainerEl: () => this.getShadowRootAsync() as any as Element,
    direction: Direction.vertical
  })

  #dragHorizontal = new DragController(this, {
    localStorageKey: 'workbenchSidebarWidth',
    minPosition: MIN_METATAB_WIDTH,
    initialPosition: MIN_METATAB_WIDTH,
    getContainerEl: () => this.#getHorizontalWindow(),
    direction: Direction.horizontal
  })

  async #getHorizontalWindow() {
    await this.updateComplete
    return this.horizontalResizerWindow as Element
  }

  #toggle(key: 'toolbar' | 'workbenchSidebar') {
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
    setTimeout(
      () =>
        window.dispatchEvent(
          new CustomEvent('window-drag', {
            bubbles: true,
            composed: true
          })
        ),
      RERENDER_TIMEOUT
    )
  }

  @query('section[data-horizontal-resizer-window]')
  horizontalResizerWindow?: HTMLElement

  render() {
    // When collapsed keep previous full behavior; when expanded no fixed height class
    const heightWorkbench = this.#toolbarCollapsed ? 'h-full flex-1' : ''

    const styleWorkbench = this.#toolbarCollapsed
      ? ''
      : (() => {
          const m = this.#dragVertical.getPosition().match(/(\d+(?:\.\d+)?)px/)
          const raw = m ? parseFloat(m[1]) : window.innerHeight * 0.7
          const capped = Math.min(raw, window.innerHeight * 0.7)
          const paneHeight = Math.max(MIN_WORKBENCH_HEIGHT, capped)
          return `flex:0 0 ${paneHeight}px; height:${paneHeight}px; max-height:70vh; min-height:0;`
        })()

    const sidebarStyle = this.#workbenchSidebarCollapsed
      ? 'width:0; flex:0 0 0; overflow:hidden;'
      : (() => {
          const pos = this.#dragHorizontal.getPosition()
          const m = pos.match(/flex-basis:\s*([\d.]+)px/)
          const w = m ? m[1] : MIN_METATAB_WIDTH
          return `${pos}; flex:0 0 auto; min-width:${w}px; max-width:${w}px;`
        })()

    return html`
      <section
        data-horizontal-resizer-window
        class="flex relative w-full ${heightWorkbench} min-h-0 overflow-hidden"
        style="${styleWorkbench}"
      >
        <section data-sidebar class="flex-none" style="${sidebarStyle}">
          <wdio-devtools-tabs
            cacheId="activeActionsTab"
            class="h-full flex flex-col border-r-[1px] border-r-panelBorder ${this
              .#workbenchSidebarCollapsed
              ? 'hidden'
              : ''}"
          >
            <wdio-devtools-tab label="Actions">
              <wdio-devtools-actions></wdio-devtools-actions>
            </wdio-devtools-tab>
            <wdio-devtools-tab label="Metadata">
              <wdio-devtools-metadata></wdio-devtools-metadata>
            </wdio-devtools-tab>
            <nav class="ml-auto" slot="actions">
              <button
                @click="${() => this.#toggle('workbenchSidebar')}"
                class="flex h-10 w-10 items-center justify-center pointer ml-auto hover:bg-toolbarHoverBackground"
              >
                <icon-mdi-arrow-collapse-left></icon-mdi-arrow-collapse-left>
              </button>
            </nav>
          </wdio-devtools-tabs>
          ${this.#workbenchSidebarCollapsed
            ? html`
                <button
                  @click="${() => this.#toggle('workbenchSidebar')}"
                  class="absolute top-2 left-2 bg-sideBarBackground flex h-10 w-10 items-center justify-center cursor-pointer rounded-md shadow hover:bg-toolbarHoverBackground border border-panelBorder"
                >
                  <icon-mdi-arrow-collapse-right></icon-mdi-arrow-collapse-right>
                </button>
              `
            : nothing}
        </section>
        ${!this.#workbenchSidebarCollapsed
          ? this.#dragHorizontal.getSlider('z-30')
          : nothing}
        <section
          class="basis-auto text-gray-500 flex items-center justify-center flex-grow"
        >
          <wdio-devtools-browser></wdio-devtools-browser>
        </section>
      </section>
      ${!this.#toolbarCollapsed
        ? this.#dragVertical.getSlider('z-[999] -mt-[5px] pointer-events-auto')
        : nothing}
      <wdio-devtools-tabs
        cacheId="activeWorkbenchTab"
        class="relative z-10 border-t-[1px] border-t-panelBorder ${this
          .#toolbarCollapsed
          ? 'hidden'
          : ''} flex-1 min-h-0 pb-10"
      >
        <wdio-devtools-tab label="Source">
          <wdio-devtools-source></wdio-devtools-source>
        </wdio-devtools-tab>
        <wdio-devtools-tab label="Log">
          <wdio-devtools-logs></wdio-devtools-logs>
        </wdio-devtools-tab>
        <wdio-devtools-tab label="Console">
          <wdio-devtools-console-logs></wdio-devtools-console-logs>
        </wdio-devtools-tab>
        <wdio-devtools-tab label="Network">
          <section
            class="flex items-center justify-center text-sm w-full h-full"
          >
            Network tab not yet implemented!
          </section>
        </wdio-devtools-tab>
        <nav class="ml-auto" slot="actions">
          <button
            @click="${() => this.#toggle('toolbar')}"
            class="flex h-10 w-10 items-center justify-center pointer ml-auto hover:bg-toolbarHoverBackground"
          >
            <icon-mdi-arrow-collapse-down></icon-mdi-arrow-collapse-down>
          </button>
        </nav>
      </wdio-devtools-tabs>
      ${this.#toolbarCollapsed
        ? html`
            <button
              @click="${() => this.#toggle('toolbar')}"
              class="fixed z-[9999] right-2 bottom-2 bg-sideBarBackground flex h-10 w-10 items-center justify-center cursor-pointer rounded-md shadow
                   hover:bg-toolbarHoverBackground border border-panelBorder"
            >
              <icon-mdi-arrow-collapse-up></icon-mdi-arrow-collapse-up>
            </button>
          `
        : nothing}
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    [COMPONENT]: DevtoolsWorkbench
  }
}
