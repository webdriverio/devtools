import { html } from 'lit'
import { Element } from '@core/element'

export class CollapseableEntry extends Element {
  allowCollapseAll = false

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

    return [...this.shadowRoot.querySelectorAll('wdio-test-entry')].some(
      (el) => el.getAttribute('is-collapsed') === 'false'
    )
  }

  collapseOrExpand(shouldExpand: boolean) {
    if (!this.shadowRoot) {
      return
    }
    const entries = [...this.shadowRoot.querySelectorAll('wdio-test-entry')]
    entries.forEach((el) => el.setAttribute('is-collapsed', `${!shouldExpand}`))
    this.allowCollapseAll = shouldExpand
    this.requestUpdate()
  }

  renderCollapseOrExpandIcon(iconClass = '') {
    return this.allowCollapseAll ||
      this.getAttribute('is-collapsed') === 'false'
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
