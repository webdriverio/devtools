import { html } from 'lit'
import { Element } from '@core/element'

export class CollapseableEntry extends Element {
  /** A tree renders its children until something collapses them, so the control
   *  on offer starts out as collapse-all. */
  allowCollapseAll = true

  connectedCallback(): void {
    super.connectedCallback()

    if (this.shadowRoot) {
      this.shadowRoot.addEventListener('entry-collapse-change', () => {
        const hasUncollapsedEntries = this.hasUncollapsedEntries()
        this.allowCollapseAll = hasUncollapsedEntries
        this.requestUpdate()
      })
    }
  }

  hasUncollapsedEntries() {
    if (!this.shadowRoot) {
      return false
    }

    // `wdio-test-entry` reflects `is-collapsed`, so the attribute's presence —
    // not its value — is the row's state.
    return [...this.shadowRoot.querySelectorAll('wdio-test-entry')].some(
      (el) => !el.hasAttribute('is-collapsed')
    )
  }

  collapseOrExpand(shouldExpand: boolean) {
    if (!this.shadowRoot) {
      return
    }
    const entries = [...this.shadowRoot.querySelectorAll('wdio-test-entry')]
    entries.forEach((el) => el.toggleAttribute('is-collapsed', !shouldExpand))
    this.allowCollapseAll = shouldExpand
    this.requestUpdate()
  }

  renderCollapseOrExpandIcon(iconClass = '') {
    return this.allowCollapseAll
      ? html`<icon-mdi-collapse-all
          @click="${() => this.collapseOrExpand(false)}"
          class="${iconClass}"
        ></icon-mdi-collapse-all>`
      : html`<icon-mdi-expand-all
          @click="${() => this.collapseOrExpand(true)}"
          class="${iconClass}"
        ></icon-mdi-expand-all>`
  }
}
