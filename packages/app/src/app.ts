import './tailwind.css'
import { css, html, nothing } from 'lit'
import { customElement, query } from 'lit/decorators.js'
import { TraceType, type TraceLog } from '@wdio/devtools-shared'

import { Element } from '@core/element'
import { DataManagerController } from './controller/DataManager.js'
import { DragController, Direction } from './utils/DragController.js'
import { SIDEBAR_MIN_WIDTH, DARK_MODE_KEY } from './controller/constants.js'
import { POPOUT_QUERY } from './components/workbench/compare/constants.js'

// Bootstrap the dark-mode class on <body> as early as possible so popout
// windows (which don't render the header) still get themed consistently
// with the main dashboard. The header still owns the toggle.
const darkModeInit = localStorage.getItem(DARK_MODE_KEY)
const isDarkMode =
  typeof darkModeInit === 'string'
    ? darkModeInit === 'true'
    : window.matchMedia('(prefers-color-scheme: dark)').matches
if (isDarkMode) {
  document.body.classList.add('dark')
}
// Cross-window sync: when the user toggles dark mode in the main dashboard,
// the storage event fires in OTHER windows (popouts) and we mirror the
// theme change there too.
window.addEventListener('storage', (e) => {
  if (e.key === DARK_MODE_KEY) {
    document.body.classList.toggle('dark', e.newValue === 'true')
  }
})

import './components/header.js'
import './components/sidebar.js'
import './components/workbench.js'
import './components/onboarding/start.js'
import './components/workbench/compare.js'

@customElement('wdio-devtools')
export class WebdriverIODevtoolsApplication extends Element {
  dataManager = new DataManagerController(this)

  // Popout mode: when opened via the Compare tab's "↗ Pop out" button the
  // URL carries ?view=compare&uid=<testUid>. The app then renders only the
  // Compare panel full-viewport (no header, no sidebar, no workbench tabs).
  #popoutMode =
    new URLSearchParams(window.location.search).get(POPOUT_QUERY.viewKey) ===
    POPOUT_QUERY.viewValue
  #popoutUid =
    new URLSearchParams(window.location.search).get(POPOUT_QUERY.uidKey) ||
    undefined

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
    // In popout mode, the URL carries the test uid the parent window was
    // viewing. Push it into the context so the Compare component finds the
    // matching baseline as soon as the WS reconnects in this new window.
    if (this.#popoutMode && this.#popoutUid) {
      this.dataManager.setSelectedTestUid(this.#popoutUid)
    }
  }

  render() {
    if (this.#popoutMode) {
      return html`
        <wdio-devtools-compare style="flex:1 1 auto;"></wdio-devtools-compare>
      `
    }
    return html`
      <wdio-devtools-header></wdio-devtools-header>
      ${this.#mainContent()}
    `
  }

  #loadTrace({ detail }: { detail: TraceLog }) {
    this.dataManager.loadTraceFile(detail)
    this.requestUpdate()
  }

  #clearExecutionData({
    detail
  }: {
    detail?: { uid?: string; entryType?: 'suite' | 'test' }
  }) {
    this.dataManager.clearExecutionData(detail?.uid, detail?.entryType)
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
