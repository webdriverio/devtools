import { Element } from '@core/element'
import { html, css, nothing, type PropertyValues } from 'lit'
import { customElement, property, query, state } from 'lit/decorators.js'
import { consume } from '@lit/context'

import { DragController, Direction } from '../utils/DragController.js'
import {
  consoleLogContext,
  metadataContext,
  networkRequestContext,
  baselineContext,
  commandContext,
  selectedTestUidContext,
  suiteContext
} from '../controller/context.js'
import type {
  CommandLog,
  ConsoleLog,
  Metadata,
  NetworkRequest,
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
  minWorkbenchHeight,
  MIN_METATAB_WIDTH,
  DEVICE_PANE_MIN_WIDTH,
  DEVICE_PANE_CHROME_ALLOWANCE,
  DEVICE_PANE_MAX_WIDTH_RATIO,
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
  consoleLogs: ConsoleLog[] | undefined = undefined

  @consume({ context: networkRequestContext, subscribe: true })
  @state()
  networkRequests: NetworkRequest[] | undefined = undefined

  @consume({ context: baselineContext, subscribe: true })
  @state()
  baselines: Map<string, PreservedAttempt> | undefined = undefined

  @consume({ context: selectedTestUidContext, subscribe: true })
  @state()
  selectedTestUid: string | undefined = undefined

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

      /* The dock must not be sized by its own content. As a flex row item its
         floor is min-content unless this is set, so switching to a wide tab
         (the Network table) grew it and shoved the device column sideways —
         only the drag handle may move that boundary. Scoped here rather than as
         a utility class so it holds wherever the shadow root is styled from. */
      section[data-device-row] > wdio-devtools-tabs {
        min-width: 0;
      }
    `
  ]

  #dragVertical = new DragController(this, {
    localStorageKey: 'toolbarHeight',
    minPosition: minWorkbenchHeight,
    maxPosition: () => window.innerHeight * 0.7,
    initialPosition: () => window.innerHeight * BROWSER_HEIGHT_RATIO,
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
    minPosition: minWorkbenchHeight,
    maxPosition: () => this.#playerPaneBudget(),
    initialPosition: () =>
      Math.max(
        minWorkbenchHeight(),
        window.innerHeight -
          HEADER_HEIGHT -
          PLAYER_CONTROLS_HEIGHT -
          TRACE_TIMELINE_DEFAULT_HEIGHT -
          PLAYER_DOCK_DEFAULT_HEIGHT
      ),
    getContainerEl: () => this.#getVerticalWindow(),
    direction: Direction.vertical
  })

  /**
   * A capture off a device gets a column of its own down the right-hand side,
   * with the dock beside it rather than under it. A portrait frame in a wide
   * row is a narrow strip with the rest backdrop; the full column height is
   * the largest such frame the window can hold.
   *
   * Keyed on the trace stating a device, in live and player mode alike. A
   * DESKTOP capture keeps the stacked layout — this is not a better layout in
   * general, only for a capture that is taller than it is wide.
   *
   * Deliberately a wider gate than the device CHROME uses (which also requires
   * no DOM and no url): a mobile browser session is still a portrait viewport
   * that wants the tall column, it just keeps its address bar inside it.
   */
  get #deviceLayout(): boolean {
    if (!this.metadata?.device) {
      return false
    }
    // A landscape capture — a device rotated mid-run, or an app that only runs
    // that way — is served better by the stacked layout, exactly as a desktop
    // one is: a wide frame in a tall column wastes the column and would claim
    // up to 60% of the window from the dock. An UNKNOWN shape is treated as
    // portrait, which is what a device reports unless it was rotated, and is
    // also all a zip recorded before the viewport was captured can offer.
    const viewport = this.metadata.viewport
    const landscape = Boolean(
      viewport?.width && viewport?.height && viewport.width > viewport.height
    )
    return !landscape
  }

  /**
   * Height the device column has to work with: what the fixed rows leave of the
   * window. Deliberately computed, not measured — measuring the row fed this
   * its own half-laid-out result (40px on the first pass, 68 on the next),
   * because the row is not final at the moment its child's width is decided.
   * The arithmetic is exact whenever the workbench fills the window, which is
   * every case but an embedded panel.
   */
  #deviceColumnHeight(): number {
    return Math.max(
      minWorkbenchHeight(),
      window.innerHeight -
        HEADER_HEIGHT -
        (this.playerMode
          ? PLAYER_CONTROLS_HEIGHT + this.#timelinePaneHeight()
          : 0)
    )
  }

  /**
   * The width at which the capture fills the column's height — the column's own
   * height times the capture's shape. It is both the default AND the maximum,
   * because a portrait capture is bound by height: past this the frame stops
   * growing and the column only gains backdrop while taking room from the dock.
   * So the drag range runs from `DEVICE_PANE_MIN_WIDTH` up to "fills the
   * height", and dragging can only trade the capture's size for the dock's.
   *
   * The shape comes from the reported viewport, the only one the workbench has;
   * the player then fits the image to its own decoded pixels inside this box,
   * so a viewport that disagrees with the screenshot costs a little backdrop
   * here and nothing in correctness.
   */
  #deviceFillWidth(): number {
    const viewport = this.metadata?.viewport
    const ratio =
      viewport?.width && viewport?.height
        ? viewport.width / viewport.height
        : 0.5
    return Math.min(
      Math.max(
        DEVICE_PANE_MIN_WIDTH,
        this.#deviceColumnHeight() * ratio + DEVICE_PANE_CHROME_ALLOWANCE
      ),
      Math.max(
        DEVICE_PANE_MIN_WIDTH,
        window.innerWidth * DEVICE_PANE_MAX_WIDTH_RATIO
      )
    )
  }

  // Width of the device column; own key so it never disturbs the other splits.
  #dragDevice = new DragController(this, {
    localStorageKey: 'devicePaneWidth',
    minPosition: DEVICE_PANE_MIN_WIDTH,
    // Capped at the useful width, not at a share of the window: beyond
    // "fills the height" the drag buys backdrop and costs the dock.
    maxPosition: () => this.#deviceFillWidth(),
    initialPosition: () => this.#deviceFillWidth(),
    getContainerEl: () => this.#getVerticalWindow(),
    direction: Direction.horizontal,
    // The pane is on the right, so its handle sits on its inner edge and
    // dragging left widens it.
    anchor: 'end'
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
      minWorkbenchHeight(),
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
      return `flex-grow:0; flex-shrink:0; ${this.#dragVerticalPlayer.getPosition()}; max-height:${maxHeight}; min-height:${minWorkbenchHeight()}px;`
    }
    const raw =
      basisPx(this.#dragVertical.getPosition()) ??
      window.innerHeight * BROWSER_HEIGHT_RATIO
    const capped = Math.min(raw, window.innerHeight * 0.7)
    const paneHeight = Math.max(minWorkbenchHeight(), capped)
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
        class="h-full flex flex-col border-r-[1px] border-r-panelBorder ${
          this.#workbenchSidebarCollapsed ? 'hidden' : ''
        }"
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

  // The panel renders the baseline of the SELECTED test and no other, so a
  // baseline held for a different test is nothing this tab could open onto.
  // Uncounted on purpose: one tab is one comparison.
  #renderCompareTabForSelectedTest() {
    if (!this.selectedTestUid || !this.baselines?.has(this.selectedTestUid)) {
      return nothing
    }
    return html`
      <wdio-devtools-tab label="Compare">
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
      ${
        this.playerMode
          ? html`<wdio-devtools-tab label="A11y">
                <wdio-devtools-a11y></wdio-devtools-a11y>
              </wdio-devtools-tab>
              <wdio-devtools-tab label="Transcript">
                <wdio-devtools-transcript></wdio-devtools-transcript>
              </wdio-devtools-tab>`
          : nothing
      }
      ${this.#renderCompareTabForSelectedTest()}
    `
  }

  #renderWorkbenchTabs() {
    return html`
      <wdio-devtools-tabs
        cacheId="activeWorkbenchTab"
        class="relative z-10 border-t-[1px] border-t-panelBorder ${
          this.#toolbarCollapsed ? 'hidden' : ''
        } flex-1 min-h-0"
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

  /**
   * `fill` is the device column: the capture takes the whole box. No height
   * from the vertical split — that split does not exist in this layout — and no
   * aspect-locked wrapper either, because the column's own width already is the
   * capture's shape and the player fits the image to its decoded pixels inside
   * whatever box it gets. Locking the aspect again here letterboxed the frame
   * inside a column that was already its shape.
   */
  #renderBrowserPane(fill = false) {
    // Player: the boxed host goes transparent and the pane carries the shared
    // backdrop, so the aspect box blends instead of showing a gradient seam.
    const playerPaneExtra = this.playerMode
      ? ` background:${BROWSER_BACKDROP_GRADIENT};`
      : ''
    const paneStyle = fill
      ? `flex:1 1 auto; min-height:0; min-width:0;${playerPaneExtra}`
      : `${this.#computeBrowserPaneStyle()}${playerPaneExtra}`
    return html`
      <section
        class="basis-auto text-gray-500 flex items-center justify-center flex-1 min-h-0"
        style="${paneStyle}"
      >
        ${
          this.playerMode && !fill
            ? html`<div
                class="h-full max-w-full mx-auto"
                style="aspect-ratio:${this.#playerAspectRatio()};"
              >
                <wdio-devtools-browser
                  style="background:transparent"
                ></wdio-devtools-browser>
              </div>`
            : html`<wdio-devtools-browser
                style="${this.playerMode ? 'background:transparent' : ''}"
              ></wdio-devtools-browser>`
        }
      </section>
    `
  }

  /** Today's layout: the capture over the dock, split by a vertical handle. */
  /**
   * The device column's default is derived from the capture's shape, and the
   * controller resolves it during field initialization — before the consumed
   * metadata context has delivered any. Re-derive when that input arrives or
   * changes; guarded on the property, so this is not a per-render recompute.
   */
  protected updated(changed: PropertyValues<this>): void {
    if (
      changed.has('metadata') &&
      this.#deviceLayout &&
      this.#dragDevice.refreshDerived()
    ) {
      this.requestUpdate()
    }
  }

  #renderStackedSplit() {
    return html`
      <section
        class="relative flex flex-col flex-1 min-w-0 min-h-0 overflow-hidden"
      >
        ${this.#renderBrowserPane()}
        ${
          !this.#toolbarCollapsed
            ? (this.playerMode
                ? this.#dragVerticalPlayer
                : this.#dragVertical
              ).getSlider('z-[999] pointer-events-auto')
            : nothing
        }
        ${this.#renderWorkbenchTabs()}
      </section>
    `
  }

  /**
   * Device layout: the dock takes the room the capture does not need, and the
   * capture takes a column of its own on the right — full height, so a portrait
   * frame is as large as the window allows instead of a strip in a wide row.
   *
   * The capture keeps its own fitting inside that column: it shapes itself to
   * its decoded pixels and re-fits through its ResizeObserver, so dragging this
   * handle needs to tell it nothing.
   */
  #renderDeviceSplit() {
    const width = basisPx(this.#dragDevice.getPosition())
    return html`
      <section
        data-device-row
        class="relative flex flex-row flex-1 min-w-0 min-h-0 overflow-hidden"
      >
        ${this.#renderWorkbenchTabs()}
        ${
          !this.#toolbarCollapsed
            ? this.#dragDevice.getSlider('z-[999] pointer-events-auto')
            : nothing
        }
        <section
          data-device-pane
          class="relative flex flex-col min-w-0 min-h-0 overflow-hidden"
          style="${this.#dragDevice.getPosition()}; flex:0 1 auto; width:${width}px; max-width:100%;"
        >
          ${this.#renderBrowserPane(true)}
        </section>
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
        ${
          !this.#workbenchSidebarCollapsed
            ? this.#dragHorizontal.getSlider('z-30')
            : nothing
        }
        <section
          data-vertical-resizer-window
          class="relative flex flex-col flex-grow min-w-0 min-h-0 overflow-hidden"
        >
          ${
            this.playerMode
              ? html`<wdio-devtools-trace-player-controls
                  class="flex-none h-10 border-b-[1px] border-b-panelBorder"
                ></wdio-devtools-trace-player-controls>`
              : nothing
          }
          ${
            this.#deviceLayout
              ? this.#renderDeviceSplit()
              : this.#renderStackedSplit()
          }
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
