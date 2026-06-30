import { Element } from '@core/element'
import { html, css, nothing } from 'lit'
import { customElement, property, query, state } from 'lit/decorators.js'
import { consume } from '@lit/context'

import { DragController, Direction } from '../utils/DragController.js'
import {
  consoleLogContext,
  networkRequestContext,
  baselineContext
} from '../controller/context.js'
import type { PreservedAttempt } from '@wdio/devtools-shared'

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
import './workbench/network.js'
import './workbench/compare.js'
import './browser/snapshot.js'
import './browser/trace-timeline.js'
import {
  MIN_WORKBENCH_HEIGHT,
  MIN_METATAB_WIDTH,
  ACTIONS_DEFAULT_WIDTH,
  BROWSER_HEIGHT_RATIO,
  RERENDER_TIMEOUT
} from '../controller/constants.js'

const COMPONENT = 'wdio-devtools-workbench'
@customElement(COMPONENT)
export class DevtoolsWorkbench extends Element {
  #toolbarCollapsed = localStorage.getItem('toolbar') === 'true'
  #workbenchSidebarCollapsed =
    localStorage.getItem('workbenchSidebar') === 'true'

  // Trace-player mode (`pnpm show-trace`): hide the Metadata tab and swap the
  // workbench tabs for the timeline player.
  @property({ type: Boolean })
  playerMode = false

  @consume({ context: consoleLogContext, subscribe: true })
  @state()
  consoleLogs: ConsoleLogs[] | undefined = undefined

  @consume({ context: networkRequestContext, subscribe: true })
  @state()
  networkRequests: NetworkRequest[] | undefined = undefined

  @consume({ context: baselineContext, subscribe: true })
  @state()
  baselines: Map<string, PreservedAttempt> | undefined = undefined

  static styles = [
    ...Element.styles,
    css`
      :host {
        display: flex;
        flex-direction: column;
        flex-grow: 1;
        /* Fill the parent (calc(100% - header)); 100vh overflowed by the 40px
           header height and clipped the bottom of the right column. */
        height: 100%;
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
    initialPosition: window.innerHeight * BROWSER_HEIGHT_RATIO,
    getContainerEl: () => this.#getVerticalWindow(),
    direction: Direction.vertical
  })

  async #getVerticalWindow() {
    await this.updateComplete
    return this.verticalResizerWindow as Element
  }

  #dragHorizontal = new DragController(this, {
    localStorageKey: 'workbenchSidebarWidth',
    minPosition: MIN_METATAB_WIDTH,
    initialPosition: ACTIONS_DEFAULT_WIDTH,
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

  @query('section[data-vertical-resizer-window]')
  verticalResizerWindow?: HTMLElement

  // Height of the screencast pane; the dock fills the rest of the right column.
  // Collapsed dock → empty string so the browser flex-grows to fill.
  #computeBrowserPaneStyle(): string {
    if (this.#toolbarCollapsed) {
      return ''
    }
    const m = this.#dragVertical.getPosition().match(/(\d+(?:\.\d+)?)px/)
    const raw = m ? parseFloat(m[1]) : window.innerHeight * BROWSER_HEIGHT_RATIO
    const capped = Math.min(raw, window.innerHeight * 0.7)
    const paneHeight = Math.max(MIN_WORKBENCH_HEIGHT, capped)
    return `flex:0 0 ${paneHeight}px; height:${paneHeight}px; max-height:70vh; min-height:0;`
  }

  #computeSidebarStyle(): string {
    if (this.#workbenchSidebarCollapsed) {
      return 'width:0; flex:0 0 0; overflow:hidden;'
    }
    const pos = this.#dragHorizontal.getPosition()
    const m = pos.match(/flex-basis:\s*([\d.]+)px/)
    const w = m ? m[1] : MIN_METATAB_WIDTH
    return `${pos}; flex:0 0 auto; min-width:${w}px; max-width:${w}px;`
  }

  #renderActionsSidebar() {
    return html`
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
        ${this.playerMode
          ? nothing
          : html`<wdio-devtools-tab label="Metadata">
              <wdio-devtools-metadata></wdio-devtools-metadata>
            </wdio-devtools-tab>`}
        <nav class="ml-auto" slot="actions">
          <button
            @click="${() => this.#toggle('workbenchSidebar')}"
            class="flex h-10 w-10 items-center justify-center pointer ml-auto hover:bg-toolbarHoverBackground"
          >
            <icon-mdi-arrow-collapse-left></icon-mdi-arrow-collapse-left>
          </button>
        </nav>
      </wdio-devtools-tabs>
    `
  }

  #renderSidebarRestoreButton() {
    if (!this.#workbenchSidebarCollapsed) {
      return nothing
    }
    return html`
      <button
        @click="${() => this.#toggle('workbenchSidebar')}"
        class="absolute z-20 top-2 left-2 bg-sideBarBackground flex h-10 w-10 items-center justify-center cursor-pointer rounded-md shadow hover:bg-toolbarHoverBackground border border-panelBorder"
      >
        <icon-mdi-arrow-collapse-right></icon-mdi-arrow-collapse-right>
      </button>
    `
  }

  #renderCompareTabIfAvailable() {
    if ((this.baselines?.size || 0) === 0) {
      return nothing
    }
    return html`
      <wdio-devtools-tab label="Compare" .badge="${this.baselines?.size || 0}">
        <wdio-devtools-compare></wdio-devtools-compare>
      </wdio-devtools-tab>
    `
  }

  #renderToolbarCollapseButton() {
    if (!this.#toolbarCollapsed) {
      return nothing
    }
    return html`
      <button
        @click="${() => this.#toggle('toolbar')}"
        class="fixed z-[9999] right-2 bottom-2 bg-sideBarBackground flex h-10 w-10 items-center justify-center cursor-pointer rounded-md shadow hover:bg-toolbarHoverBackground border border-panelBorder group"
      >
        <icon-mdi-arrow-collapse-up
          class="group-hover:text-chartsBlue"
        ></icon-mdi-arrow-collapse-up>
      </button>
    `
  }

  #renderWorkbenchTabs() {
    return html`
      <wdio-devtools-tabs
        cacheId="activeWorkbenchTab"
        class="relative z-10 border-t-[1px] border-t-panelBorder ${this
          .#toolbarCollapsed
          ? 'hidden'
          : ''} flex-1 min-h-0"
      >
        <wdio-devtools-tab label="Source">
          <wdio-devtools-source></wdio-devtools-source>
        </wdio-devtools-tab>
        <wdio-devtools-tab label="Log">
          <wdio-devtools-logs></wdio-devtools-logs>
        </wdio-devtools-tab>
        <wdio-devtools-tab
          label="Console"
          .badge="${this.consoleLogs?.length || 0}"
        >
          <wdio-devtools-console-logs
            id="console-logs-tab"
          ></wdio-devtools-console-logs>
        </wdio-devtools-tab>
        <wdio-devtools-tab
          label="Network"
          .badge="${this.networkRequests?.length || 0}"
        >
          <wdio-devtools-network></wdio-devtools-network>
        </wdio-devtools-tab>
        ${this.#renderCompareTabIfAvailable()}
        <nav class="ml-auto" slot="actions">
          <button
            @click="${() => this.#toggle('toolbar')}"
            class="flex h-10 w-10 items-center justify-center pointer ml-auto hover:bg-toolbarHoverBackground group"
          >
            <icon-mdi-arrow-collapse-down
              class="group-hover:text-chartsBlue"
            ></icon-mdi-arrow-collapse-down>
          </button>
        </nav>
      </wdio-devtools-tabs>
      ${this.#renderToolbarCollapseButton()}
    `
  }

  render() {
    return html`
      <section
        data-horizontal-resizer-window
        class="flex relative w-full h-full min-h-0 overflow-hidden"
      >
        <section
          data-sidebar
          class="flex-none"
          style="${this.#computeSidebarStyle()}"
        >
          ${this.#renderActionsSidebar()}
        </section>
        ${this.#renderSidebarRestoreButton()}
        ${!this.#workbenchSidebarCollapsed
          ? this.#dragHorizontal.getSlider('z-30')
          : nothing}
        <section
          data-vertical-resizer-window
          class="relative flex flex-col flex-grow min-w-0 min-h-0 overflow-hidden"
        >
          <section
            class="basis-auto text-gray-500 flex items-center justify-center flex-1 min-h-0"
            style="${this.#computeBrowserPaneStyle()}"
          >
            <wdio-devtools-browser></wdio-devtools-browser>
          </section>
          ${!this.#toolbarCollapsed
            ? this.#dragVertical.getSlider('z-[999] pointer-events-auto')
            : nothing}
          ${this.playerMode
            ? html`<wdio-devtools-trace-timeline
                class="relative z-10 border-t-[1px] border-t-panelBorder flex-1 min-h-0"
              ></wdio-devtools-trace-timeline>`
            : this.#renderWorkbenchTabs()}
        </section>
      </section>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    [COMPONENT]: DevtoolsWorkbench
  }
}
