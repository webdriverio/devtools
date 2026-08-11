import { Element } from '@core/element'
import { html, css, nothing } from 'lit'
import { customElement, property } from 'lit/decorators.js'

const COMPONENT = 'wdio-devtools-shortcuts'

/** Shortcuts (key, description, player-only). Player-only rows are dimmed in
 *  the live dashboard where the keys are no-ops. */
const SHORTCUTS: Array<[string, string, boolean]> = [
  ['Space', 'Play / pause', true],
  ['← / →', 'Previous / next action', true],
  ['Home / End', 'First / last action', true],
  [', / .', 'Slower / faster', true],
  ['/', 'Focus filter', false],
  ['?', 'Toggle this help', false]
]

@customElement(COMPONENT)
export class DevtoolsShortcuts extends Element {
  @property({ type: Boolean }) open = false
  @property({ type: Boolean }) playerMode = false

  static styles = [
    ...Element.styles,
    css`
      .backdrop {
        position: fixed;
        inset: 0;
        z-index: 1000;
        display: grid;
        place-items: center;
        background: rgba(0, 0, 0, 0.5);
      }
      .panel {
        width: min(420px, 92vw);
        background: var(--vscode-editor-background);
        border: 1px solid var(--vscode-panel-border);
        border-radius: 12px;
        box-shadow: 0 24px 60px -20px #000;
        overflow: hidden;
      }
      header {
        display: flex;
        align-items: center;
        padding: 12px 16px;
        border-bottom: 1px solid var(--vscode-panel-border);
        font-size: 14px;
        font-weight: 600;
      }
      header .x {
        margin-left: auto;
        cursor: pointer;
        padding: 2px 7px;
        border-radius: 6px;
        color: var(--vscode-descriptionForeground);
      }
      header .x:hover {
        background: var(--vscode-toolbar-hoverBackground);
      }
      dl {
        margin: 0;
        padding: 10px 16px 16px;
        display: grid;
        grid-template-columns: auto 1fr;
        gap: 9px 18px;
        align-items: center;
      }
      dt {
        text-align: right;
      }
      kbd {
        font-family: monospace;
        font-size: 11.5px;
        padding: 2px 7px;
        border: 1px solid var(--vscode-panel-border);
        border-bottom-width: 2px;
        border-radius: 6px;
        background: var(--vscode-sideBar-background);
        white-space: nowrap;
      }
      dd {
        margin: 0;
        font-size: 13px;
        color: var(--vscode-foreground);
      }
      dd.dim {
        opacity: 0.45;
      }
    `
  ]

  #close = () => this.dispatchEvent(new CustomEvent('close'))

  #onKeydown = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && this.open) {
      event.preventDefault()
      this.#close()
    }
  }

  connectedCallback(): void {
    super.connectedCallback()
    window.addEventListener('keydown', this.#onKeydown)
  }

  disconnectedCallback(): void {
    super.disconnectedCallback()
    window.removeEventListener('keydown', this.#onKeydown)
  }

  render() {
    if (!this.open) {
      return nothing
    }
    return html`
      <div class="backdrop" @click="${this.#close}">
        <div class="panel" @click="${(e: Event) => e.stopPropagation()}">
          <header>
            Keyboard shortcuts <span class="x" @click="${this.#close}">✕</span>
          </header>
          <dl>
            ${SHORTCUTS.map(
              ([key, desc, playerOnly]) => html`
                <dt><kbd>${key}</kbd></dt>
                <dd class="${playerOnly && !this.playerMode ? 'dim' : ''}">
                  ${desc}
                </dd>
              `
            )}
          </dl>
        </div>
      </div>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    [COMPONENT]: DevtoolsShortcuts
  }
}
