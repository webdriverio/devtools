import { Element } from '@core/element'
import { html, css } from 'lit'
import { customElement } from 'lit/decorators.js'

import '~icons/custom/logo.svg'
import '~icons/mdi/white-balance-sunny.js'
import '~icons/mdi/moon-waning-crescent.js'

import { DARK_MODE_KEY } from '../controller/constants.js'

/** The theme to render: the choice the user stored, else the OS setting. The
 *  header owns the toggle, so it owns this rule — `app.ts` bootstraps `<body>`
 *  from the same function so the document and the icon can't disagree. */
export function prefersDarkMode(): boolean {
  const stored = localStorage.getItem(DARK_MODE_KEY)
  return stored === null
    ? window.matchMedia('(prefers-color-scheme: dark)').matches
    : stored === 'true'
}

@customElement('wdio-devtools-header')
export class DevtoolsHeader extends Element {
  // Read per instance, not once per module load: a header built after the theme
  // changed elsewhere would otherwise render the icon of the old one.
  #darkMode = prefersDarkMode()

  constructor() {
    super()
    document.body.classList.toggle('dark', this.#darkMode)
  }

  connectedCallback(): void {
    super.connectedCallback()
    window.addEventListener('storage', this.#onStorage)
  }

  disconnectedCallback(): void {
    super.disconnectedCallback()
    window.removeEventListener('storage', this.#onStorage)
  }

  // Another window (a popout, a second dashboard tab) stored a new theme — the
  // `storage` event only fires for changes made outside this one.
  #onStorage = (event: StorageEvent): void => {
    if (event.key !== DARK_MODE_KEY) {
      return
    }
    this.#darkMode = prefersDarkMode()
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
      <nav class="ml-auto mr-3">
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

  #switchMode() {
    this.#darkMode = !this.#darkMode
    document.body.classList.toggle('dark', this.#darkMode)
    localStorage.setItem(DARK_MODE_KEY, this.#darkMode ? 'true' : 'false')
    this.requestUpdate()
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'wdio-devtools-header': DevtoolsHeader
  }
}
