import { Element } from '@core/element'
import { html, css, nothing } from 'lit'
import { customElement, property, query, state } from 'lit/decorators.js'
import { consume } from '@lit/context'

import { DragController, Direction } from '../utils/DragController.js'
import {
  consoleLogContext,
  metadataContext,
  networkRequestContext,
  baselineContext,
  commandContext,
  suiteContext
} from '../controller/context.js'
import type {
  CommandLog,
  Metadata,
  PreservedAttempt
} from '@wdio/devtools-shared'
import type { SuiteStatsFragment } from '../controller/types.js'
import { collectErrors } from './workbench/errors/collect.js'

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
import './workbench/errors.js'
import './workbench/a11y-tree.js'
import './workbench/transcript.js'
import './workbench/compare.js'
import './browser/snapshot.js'
import './browser/trace-timeline.js'
import './browser/trace-player-controls.js'
import {
  BROWSER_BACKDROP_GRADIENT,
  HEADER_HEIGHT,
  MIN_WORKBENCH_HEIGHT,
  MIN_METATAB_WIDTH,
  ACTIONS_DEFAULT_WIDTH,
  BROWSER_HEIGHT_RATIO,
  PLAYER_CONTROLS_HEIGHT,
  PLAYER_DOCK_DEFAULT_HEIGHT,
  PLAYER_DOCK_MIN_HEIGHT,
  PLAYER_SNAPSHOT_WIDTH_RATIO,
  RERENDER_TIMEOUT,
  TRACE_TIMELINE_MIN_HEIGHT,
  TRACE_TIMELINE_DEFAULT_HEIGHT
} from '../controller/constants.js'

const COMPONENT = 'wdio-devtools-workbench'

/** Pixel value from a DragController position string (`flex-basis: 123px`). */
function basisPx(position: string): number | undefined {
  const value = parseFloat(position.split(':')[1] ?? '')
  return Number.isFinite(value) ? value : undefined
}
@customElement(COMPONENT)
export class DevtoolsWorkbench extends Element {
  #toolbarCollapsed = localStorage.getItem('toolbar') === 'true'
  #workbenchSidebarCollapsed =
    localStorage.getItem('workbenchSidebar') === 'true'

  // Trace-player mode: full workbench plus the timeline strip and controls bar.
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

  @consume({ context: commandContext, subscribe: true })
  @state()
  commands: CommandLog[] | undefined = undefined

  @consume({ context: suiteContext, subscribe: true })
  @state()
  suites: Record<string, SuiteStatsFragment>[] | undefined = undefined

  @consume({ context: metadataContext, subscribe: true })
  @state()
  metadata: Metadata | undefined = undefined

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

  #dragTimeline = new DragController(this, {
    localStorageKey: 'traceTimelineHeight',
    minPosition: TRACE_TIMELINE_MIN_HEIGHT,
    maxPosition: () => window.innerHeight * 0.4,
    initialPosition: TRACE_TIMELINE_DEFAULT_HEIGHT,
    getContainerEl: () => this.#getVerticalWindow(),
    direction: Direction.vertical
  })

  // Player-mode pane height; own storage key so it never disturbs the live split.
  // The live max bound keeps the handle (and pane) inside the current budget.
  #dragVerticalPlayer = new DragController(this, {
    localStorageKey: 'playerPaneHeight',
    minPosition: MIN_WORKBENCH_HEIGHT,
    maxPosition: () => this.#playerPaneBudget(),
    initialPosition: Math.max(
      MIN_WORKBENCH_HEIGHT,
      window.innerHeight -
        HEADER_HEIGHT -
        PLAYER_CONTROLS_HEIGHT -
        TRACE_TIMELINE_DEFAULT_HEIGHT -
        PLAYER_DOCK_DEFAULT_HEIGHT
    ),
    getContainerEl: () => this.#getVerticalWindow(),
    direction: Direction.vertical
  })

  // Player snapshot keeps the recorded viewport's shape, slightly narrowed.
  #playerAspectRatio(): string {
    const viewport = this.metadata?.viewport
    const width = Math.round(
      (viewport?.width || 1280) * PLAYER_SNAPSHOT_WIDTH_RATIO
    )
    return `${width} / ${viewport?.height || 800}`
  }

  // Space left for the snapshot pane once the fixed rows and dock minimum eat theirs.
  #playerPaneBudget(): number {
    return Math.max(
      MIN_WORKBENCH_HEIGHT,
      window.innerHeight -
        HEADER_HEIGHT -
        PLAYER_CONTROLS_HEIGHT -
        PLAYER_DOCK_MIN_HEIGHT -
        this.#timelinePaneHeight()
    )
  }

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
    if (this.playerMode) {
      // Snapshot pane dominates; the CSS clamp keeps the dock minimum in view.
      // Literal getPosition() basis lets adjustPosition sync slider ↔ clamped height.
      const maxHeight = `calc(100vh - ${
        HEADER_HEIGHT + PLAYER_CONTROLS_HEIGHT + PLAYER_DOCK_MIN_HEIGHT
      }px - ${this.#timelinePaneHeight()}px)`
      return `flex-grow:0; flex-shrink:0; ${this.#dragVerticalPlayer.getPosition()}; max-height:${maxHeight}; min-height:${MIN_WORKBENCH_HEIGHT}px;`
    }
    const raw =
      basisPx(this.#dragVertical.getPosition()) ??
      window.innerHeight * BROWSER_HEIGHT_RATIO
    const capped = Math.min(raw, window.innerHeight * 0.7)
    const paneHeight = Math.max(MIN_WORKBENCH_HEIGHT, capped)
    return `flex:0 0 ${paneHeight}px; height:${paneHeight}px; max-height:70vh; min-height:0;`
  }

  #timelinePaneHeight(): number {
    const raw =
      basisPx(this.#dragTimeline.getPosition()) ?? TRACE_TIMELINE_DEFAULT_HEIGHT
    const capped = Math.min(raw, window.innerHeight * 0.4)
    return Math.max(TRACE_TIMELINE_MIN_HEIGHT, capped)
  }

  #computeTimelinePaneStyle(): string {
    const paneHeight = this.#timelinePaneHeight()
    return `flex:0 0 ${paneHeight}px; height:${paneHeight}px; max-height:40vh; min-height:0;`
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

  #errorCount(): number {
    return collectErrors(this.commands, this.suites).length
  }

  // Dock tab list — extracted so #renderWorkbenchTabs stays under the size cap.
  #renderDockTabItems() {
    return html`
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
      <wdio-devtools-tab
        label="Errors"
        badgeTone="danger"
        .badge="${this.#errorCount()}"
      >
        <wdio-devtools-errors></wdio-devtools-errors>
      </wdio-devtools-tab>
      ${this.playerMode
        ? html`<wdio-devtools-tab label="A11y">
              <wdio-devtools-a11y></wdio-devtools-a11y>
            </wdio-devtools-tab>
            <wdio-devtools-tab label="Transcript">
              <wdio-devtools-transcript></wdio-devtools-transcript>
            </wdio-devtools-tab>`
        : nothing}
      ${this.#renderCompareTabIfAvailable()}
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
        ${this.#renderDockTabItems()}
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

  #renderBrowserPane() {
    // Player: the boxed host goes transparent and the pane carries the shared
    // backdrop, so the aspect box blends instead of showing a gradient seam.
    const playerPaneExtra = this.playerMode
      ? ` background:${BROWSER_BACKDROP_GRADIENT};`
      : ''
    return html`
      <section
        class="basis-auto text-gray-500 flex items-center justify-center flex-1 min-h-0"
        style="${this.#computeBrowserPaneStyle()}${playerPaneExtra}"
      >
        ${this.playerMode
          ? html`<div
              class="h-full max-w-full mx-auto"
              style="aspect-ratio:${this.#playerAspectRatio()};"
            >
              <wdio-devtools-browser
                style="background:transparent"
              ></wdio-devtools-browser>
            </div>`
          : html`<wdio-devtools-browser></wdio-devtools-browser>`}
      </section>
    `
  }

  // Full-width playback strip above the workbench row — player mode only.
  #renderTimelineStrip() {
    if (!this.playerMode) {
      return nothing
    }
    return html`
      <wdio-devtools-trace-timeline
        class="relative z-10 flex-none border-b-[1px] border-b-panelBorder"
        style="${this.#computeTimelinePaneStyle()}"
      ></wdio-devtools-trace-timeline>
      ${this.#dragTimeline.getSlider('z-[999] pointer-events-auto')}
    `
  }

  render() {
    return html`
      ${this.#renderTimelineStrip()}
      <section
        data-horizontal-resizer-window
        class="flex relative w-full flex-1 min-h-0 overflow-hidden"
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
          ${this.playerMode
            ? html`<wdio-devtools-trace-player-controls
                class="flex-none h-10 border-b-[1px] border-b-panelBorder"
              ></wdio-devtools-trace-player-controls>`
            : nothing}
          <section
            class="relative flex flex-col flex-1 min-w-0 min-h-0 overflow-hidden"
          >
            ${this.#renderBrowserPane()}
            ${!this.#toolbarCollapsed
              ? (this.playerMode
                  ? this.#dragVerticalPlayer
                  : this.#dragVertical
                ).getSlider('z-[999] pointer-events-auto')
              : nothing}
            ${this.#renderWorkbenchTabs()}
          </section>
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
