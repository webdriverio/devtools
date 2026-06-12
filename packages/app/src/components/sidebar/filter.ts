import { Element } from '@core/element'
import { html, css } from 'lit'
import { customElement, query } from 'lit/decorators.js'

import '~icons/mdi/magnify.js'

@customElement('wdio-devtools-sidebar-filter')
export class DevtoolsSidebarFilter extends Element {
  #filterQuery = ''

  static styles = [
    ...Element.styles,
    css`
      :host {
        display: block;
        width: 100%;
        font-size: 0.8em;
      }

      .field {
        display: flex;
        align-items: center;
        gap: 0.4rem;
        height: 2rem;
        padding: 0 0.6rem;
        border: 1px solid var(--vscode-panel-border);
        border-radius: 8px;
        background: var(--vscode-input-background);
        box-shadow: 0 1px 2px var(--vscode-widget-shadow);
        transition: border-color 0.12s;
      }
      .field:focus-within {
        border-color: var(--accent);
      }
      .field icon-mdi-magnify {
        flex: none;
        width: 1rem;
        height: 1rem;
        display: block;
        color: var(--vscode-descriptionForeground);
      }
      .field input {
        flex: 1;
        min-width: 0;
        height: 100%;
        border: none;
        background: none;
        color: var(--vscode-input-foreground);
        outline: none;
      }
    `
  ]

  @query('input[name="filter"]')
  queryInput?: HTMLInputElement

  #updateQuery() {
    if (!this.queryInput) {
      return
    }
    this.#filterQuery = this.queryInput.value
    this.#emitState()
  }

  #emitState() {
    window.dispatchEvent(
      new CustomEvent('app-test-filter', {
        bubbles: true,
        composed: true,
        detail: this
      })
    )
  }

  get filterQuery() {
    return this.#filterQuery
  }

  render() {
    return html`
      <div class="field">
        <icon-mdi-magnify></icon-mdi-magnify>
        <input
          type="text"
          name="filter"
          placeholder="Filter (e.g. text, @tag)"
          @keyup="${this.#updateQuery.bind(this)}"
        />
      </div>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'wdio-devtools-sidebar-filter': DevtoolsSidebarFilter
  }
}
