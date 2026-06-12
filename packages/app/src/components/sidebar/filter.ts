import { Element } from '@core/element'
import { html, css } from 'lit'
import { customElement, query } from 'lit/decorators.js'

@customElement('wdio-devtools-sidebar-filter')
export class DevtoolsSidebarFilter extends Element {
  #filterQuery = ''

  static styles = [
    ...Element.styles,
    css`
      :host {
        width: 100%;
        display: block;
        font-size: 0.8em;
        padding: 0 0.75rem;
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
      <input
        type="text"
        name="filter"
        placeholder="Filter (e.g. text, @tag)"
        class="h-6 w-full my-2 px-2"
        @keyup="${this.#updateQuery.bind(this)}"
      />
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'wdio-devtools-sidebar-filter': DevtoolsSidebarFilter
  }
}
