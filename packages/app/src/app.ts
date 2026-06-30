import './tailwind.css'
import { css, html, nothing } from 'lit'
import { customElement, query, state } from 'lit/decorators.js'
import { TraceType, type CommandLog } from '@wdio/devtools-shared'

import { Element } from '@core/element'
import { DataManagerController } from './controller/DataManager.js'
import { KeyboardController, KBD } from './controller/keyboard.js'
import { DragController, Direction } from './utils/DragController.js'
import {
  SIDEBAR_MIN_WIDTH,
  SIDEBAR_DEFAULT_WIDTH,
  DARK_MODE_KEY
} from './controller/constants.js'
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
// Follow live OS theme changes while the user hasn't set an explicit override.
window
  .matchMedia('(prefers-color-scheme: dark)')
  .addEventListener('change', (e) => {
    if (localStorage.getItem(DARK_MODE_KEY) === null) {
      document.body.classList.toggle('dark', e.matches)
    }
  })

import './components/header.js'
import './components/sidebar.js'
import './components/workbench.js'
import './components/onboarding/start.js'
import './components/workbench/compare.js'
import './components/shortcuts-overlay.js'

@customElement('wdio-devtools')
export class WebdriverIODevtoolsApplication extends Element {
  dataManager = new DataManagerController(this)

  @state() showShortcuts = false

  constructor() {
    super()
    // Global keyboard shortcuts — a side-effect controller (hooks window
    // keydown via addController); active in both the player and live dashboard.
    new KeyboardController(this, {
      isPlayer: () => this.dataManager.playerMode,
      toggleHelp: () => {
        this.showShortcuts = !this.showShortcuts
      }
    })
  }

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
    initialPosition: SIDEBAR_DEFAULT_WIDTH,
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

  /** Timestamp of the command last surfaced via `show-command` — the anchor
   *  for keyboard command navigation in the live dashboard. */
  #activeCommandTs?: number

  connectedCallback(): void {
    super.connectedCallback()
    this.addEventListener(
      'clear-execution-data',
      this.#clearExecutionData.bind(this)
    )
    window.addEventListener('show-command', this.#onShowCommand)
    window.addEventListener(KBD.step, this.#onKbdStep)
    window.addEventListener(KBD.jump, this.#onKbdJump)
    // In popout mode, the URL carries the test uid the parent window was
    // viewing. Push it into the context so the Compare component finds the
    // matching baseline as soon as the WS reconnects in this new window.
    if (this.#popoutMode && this.#popoutUid) {
      this.dataManager.setSelectedTestUid(this.#popoutUid)
    }
  }

  disconnectedCallback(): void {
    super.disconnectedCallback()
    window.removeEventListener('show-command', this.#onShowCommand)
    window.removeEventListener(KBD.step, this.#onKbdStep)
    window.removeEventListener(KBD.jump, this.#onKbdJump)
  }

  #onShowCommand = (event: Event): void => {
    const command = (event as CustomEvent<{ command?: CommandLog }>).detail
      ?.command
    if (command) {
      this.#activeCommandTs = command.timestamp
    }
  }

  /** Commands sorted by time — the dashboard's keyboard-navigable order. */
  get #sortedCommands(): CommandLog[] {
    return [...(this.dataManager.commandsContextProvider.value ?? [])].sort(
      (a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0)
    )
  }

  #selectCommand(command: CommandLog): void {
    this.#activeCommandTs = command.timestamp
    // Mirror actions.ts: elapsed time is the command's offset from the first
    // command, so keyboard selection shows the same duration as a mouse click.
    const baseline = this.#sortedCommands[0]?.timestamp ?? 0
    const elapsedTime = (command.timestamp ?? baseline) - baseline
    window.dispatchEvent(
      new CustomEvent('show-command', { detail: { command, elapsedTime } })
    )
  }

  // In the live dashboard, ←/→ walk the command list (the player's timeline
  // handles these in player mode, so skip there).
  #onKbdStep = (event: Event): void => {
    if (this.dataManager.playerMode) {
      return
    }
    const commands = this.#sortedCommands
    if (!commands.length) {
      return
    }
    const dir = (event as CustomEvent<{ dir: -1 | 1 }>).detail.dir
    let index = commands.findIndex((c) => c.timestamp === this.#activeCommandTs)
    if (index === -1) {
      index = dir > 0 ? -1 : commands.length
    }
    const next = Math.min(commands.length - 1, Math.max(0, index + dir))
    this.#selectCommand(commands[next])
  }

  #onKbdJump = (event: Event): void => {
    if (this.dataManager.playerMode) {
      return
    }
    const commands = this.#sortedCommands
    if (!commands.length) {
      return
    }
    const to = (event as CustomEvent<{ to: 'start' | 'end' }>).detail.to
    this.#selectCommand(
      to === 'end' ? commands[commands.length - 1] : commands[0]
    )
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
      <wdio-devtools-shortcuts
        .open="${this.showShortcuts}"
        .playerMode="${this.dataManager.playerMode}"
        @close="${() => (this.showShortcuts = false)}"
      ></wdio-devtools-shortcuts>
    `
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
          // Only render the test-suite sidebar (and its resize slider) when the
          // trace came from a testrunner — the player (standalone) has no tree,
          // so the slider would otherwise show a stray dragger on hover.
          this.dataManager.traceType === TraceType.Testrunner
            ? html`<wdio-devtools-sidebar
                  style="${this.#drag?.getPosition()}"
                ></wdio-devtools-sidebar>
                ${this.#drag.getSlider('z-10 h-full')}`
            : nothing
        }
        <wdio-devtools-workbench
          class="basis-auto"
          .playerMode="${this.dataManager.playerMode}"
        ></wdio-devtools-workbench>
      </section>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'wdio-devtools': WebdriverIODevtoolsApplication
  }
}
