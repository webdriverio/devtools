import { Element } from '@core/element'
import { html, css, nothing } from 'lit'
import { customElement, query } from 'lit/decorators.js'

import '~icons/custom/logo.svg'
import '~icons/mdi/white-balance-sunny.js'
import '~icons/mdi/moon-waning-crescent.js'
import '~icons/mdi/upload.js'

import {
  applyDarkMode,
  onThemeChange,
  prefersDarkMode,
  storeDarkMode
} from '../controller/theme.js'
import { HOSTED_PLAYER } from '../controller/constants.js'
import { TRACE_FILE_ACCEPT } from '../controller/constants.js'
import { announceTraceSources, takePickedSources } from '../utils/trace-file.js'

@customElement('wdio-devtools-header')
export class DevtoolsHeader extends Element {
  // Read per instance, not once per module load: a header built after the theme
  // changed elsewhere would otherwise render the icon of the old one.
  #darkMode = prefersDarkMode()

  #unwatchTheme?: () => void

  constructor() {
    super()
    applyDarkMode(this.#darkMode)
  }

  connectedCallback(): void {
    super.connectedCallback()
    // Another window stored a theme, or the OS flipped while nothing is stored:
    // either way the icon has to follow, or it contradicts the document.
    this.#unwatchTheme = onThemeChange((dark) => this.#renderTheme(dark))
  }

  disconnectedCallback(): void {
    super.disconnectedCallback()
    this.#unwatchTheme?.()
    this.#unwatchTheme = undefined
  }

  // The one place the header adopts a theme: icon and document move together.
  #renderTheme(dark: boolean): void {
    this.#darkMode = dark
    applyDarkMode(dark)
    this.requestUpdate()
  }

  static styles = [
    ...Element.styles,
    css`
      :host {
        display: flex;
        align-items: center;
        gap: 10px;
        box-sizing: border-box;
        /* Token-based so the header tracks the theme (dark bar in dark mode,
           light bar in light mode). */
        background: linear-gradient(
          180deg,
          var(--vscode-sideBar-background),
          var(--vscode-editor-background)
        );
        border-bottom: 1px solid var(--vscode-panel-border) !important;
        height: 40px;
        width: 100%;
      }

      icon-custom-logo {
        flex: none;
        width: 28px;
        height: 28px;
        /* Left inset set on the element itself (deterministic) rather than
           :host padding. */
        margin-left: 16px;
        border-radius: 8px;
        overflow: hidden;
        box-shadow: 0 2px 12px rgba(255, 122, 60, 0.4);
      }

      h1 {
        font-size: 15px;
        font-weight: 700;
        letter-spacing: 0.2px;
        color: var(--vscode-foreground);
      }
    `
  ]

  render() {
    return html`
      <icon-custom-logo></icon-custom-logo>
      <h1>WebdriverIO Devtools</h1>
      <nav class="ml-auto mr-3 flex items-center">
        ${HOSTED_PLAYER ? this.#openTraceButton() : nothing}
        <button class="p-2" @click="${this.#switchMode}">
          <icon-mdi-moon-waning-crescent
            class="${this.#darkMode ? 'hidden' : 'show'}"
          ></icon-mdi-moon-waning-crescent>
          <icon-mdi-white-balance-sunny
            class="${this.#darkMode ? 'show' : 'hidden'}"
          ></icon-mdi-white-balance-sunny>
        </button>
      </nav>
    `
  }

  @query('input[type="file"]') traceInput?: HTMLInputElement

  #openTraceButton() {
    return html`
      <button
        class="p-2"
        title="Open trace .zip files, or drop a folder of them on the page"
        aria-label="Open trace .zip files"
        @click="${() => this.traceInput?.click()}"
      >
        <icon-mdi-upload></icon-mdi-upload>
      </button>
      <input
        type="file"
        accept="${TRACE_FILE_ACCEPT}"
        multiple
        hidden
        @change="${() => this.#onTracePicked(this.traceInput)}"
      />
    `
  }

  #onTracePicked(input?: HTMLInputElement) {
    announceTraceSources(this, takePickedSources(input))
  }

  #switchMode() {
    const dark = !this.#darkMode
    storeDarkMode(dark)
    this.#renderTheme(dark)
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'wdio-devtools-header': DevtoolsHeader
  }
}
