import { Element } from '@core/element'
import { html, css } from 'lit'
import { customElement, query } from 'lit/decorators.js'

import { DragController, Direction } from '../utils/DragController.js'

import './tabs.js'
import './workbench/source.js'
import './workbench/actions.js'
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

  @query('section[data-horizontal-resizer-window]')
  horizontalResizerWindow?: HTMLElement

  render() {
    return html`
      <section data-horizontal-resizer-window class="flex h-[70%] w-full" style="${this.#dragVertical.getPosition()}">
        <section style="${this.#dragHorizontal.getPosition()}">
          <wdio-devtools-tabs class="h-full flex flex-col border-r-[1px] border-r-panelBorder">
            <wdio-devtools-tab label="Actions">
              <wdio-devtools-actions></wdio-devtools-actions>
            </wdio-devtools-tab>
            <wdio-devtools-tab label="Metadata">
              Metadata tab not yet implemented!
            </wdio-devtools-tab>
          </wdio-devtools-tabs>
        </section>
        <section class="basis-auto text-gray-500 flex items-center justify-center flex-grow">
          <wdio-devtools-browser></wdio-devtools-browser>
        </section>
        ${this.#dragHorizontal.getSlider()}
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
      ${this.#dragVertical.getSlider()}
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    [COMPONENT]: DevtoolsWorkbench;
  }
}
