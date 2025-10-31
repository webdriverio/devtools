import { Element } from '@core/element'
import { html, css } from 'lit'
import { customElement, query } from 'lit/decorators.js'

import '~icons/mdi/chevron-right.js'

enum FilterState {
  PASSED = 1,
  FAILED = 2,
  SKIPPED = 4
}

@customElement('wdio-devtools-sidebar-filter')
export class DevtoolsSidebarFilter extends Element {
  #filterState = 0
  #filterQuery = ''
  #isStateFilterOpen = false

  static styles = [
    ...Element.styles,
    css`
      :host {
        width: 100%;
        display: flex;
        align-items: top;
        font-size: 0.8em;
        padding-right: 1em;
      }

      label {
        cursor: pointer;
      }
    `
  ]

  @query('input[name="filter"]')
  queryInput?: HTMLInputElement

  #updateState(change: any) {
    if (!change.target) {
      return
    }
    this.#filterState = change.target.checked
      ? this.#filterState + Number(change.target.value)
      : this.#filterState - Number(change.target.value)
    this.requestUpdate()
    this.#emitState()
  }

  #updateQuery() {
    if (!this.queryInput) {
      return
    }
    this.#filterQuery = this.queryInput.value
    this.#emitState()
  }

  #toggleStateFilter() {
    this.#isStateFilterOpen = !this.#isStateFilterOpen
    this.requestUpdate()
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

  get filtersPassed() {
    return this.#filterState & FilterState.PASSED
  }
  get filtersFailed() {
    return this.#filterState & FilterState.FAILED
  }
  get filtersSkipped() {
    return this.#filterState & FilterState.SKIPPED
  }
  get filterStatus() {
    if (this.filtersPassed && this.filtersFailed && this.filtersSkipped) {
      return 'all'
    }

    return (
      ['passed', 'failed', 'skipped']
        .filter(
          (filter) =>
            this[
              `filters${filter.charAt(0).toUpperCase() + filter.slice(1)}` as keyof typeof this
            ]
        )
        .join(', ') || 'none'
    )
  }
  get filterQuery() {
    return this.#filterQuery
  }

  render() {
    return html`
      <button
        class="pointer p-2 h-10"
        @click="${() => this.#toggleStateFilter()}"
      >
        <icon-mdi-chevron-right
          class="transition-transform text-base block ${this.#isStateFilterOpen
            ? 'block rotate-90'
            : ''}"
        ></icon-mdi-chevron-right>
      </button>
      <div class="flex flex-col w-full">
        <input
          type="text"
          name="filter"
          placeholder="Filter (e.g. text, @tag)"
          class="h-6 w-full my-2 px-2"
          @keyup="${this.#updateQuery.bind(this)}"
        />
        <div class="mb-2">
          <em class="text-disabledForeground not-italic font-bold">Status:</em>
          ${this.filterStatus}
        </div>
        <form
          @change="${this.#updateState}"
          class="${this.#isStateFilterOpen ? 'show' : 'hidden'}"
        >
          <ul class="block w-full">
            <li>
              <input
                type="checkbox"
                value="${FilterState.PASSED}"
                name="passed"
                id="passed"
              />
              <label for="passed">Passed</label>
            </li>
            <li>
              <input
                type="checkbox"
                value="${FilterState.FAILED}"
                name="failed"
                id="failed"
              />
              <label for="failed">Failed</label>
            </li>
            <li>
              <input
                type="checkbox"
                value="${FilterState.SKIPPED}"
                name="skipped"
                id="skipped"
              />
              <label for="skipped">Skipped</label>
            </li>
          </ul>
        </form>
      </div>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'wdio-devtools-sidebar-filter': DevtoolsSidebarFilter
  }
}
