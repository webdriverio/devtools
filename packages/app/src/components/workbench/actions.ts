import { Element } from '@core/element'
import { html, css } from 'lit'
import { customElement } from 'lit/decorators.js'
import { consume } from '@lit/context'

import { context, type TraceLog } from '../../context.js'

import '~icons/mdi/pencil.js'
import '~icons/mdi/family-tree.js'
import '~icons/mdi/alert.js'
import '~icons/mdi/document.js'

const ICON_CLASS = 'w-[20px] h-[20px] m-1 mr-2 shrink-0'

const SOURCE_COMPONENT = 'wdio-devtools-actions'
@customElement(SOURCE_COMPONENT)
export class DevtoolsActions extends Element {
  #mutations: MutationRecord[] = []
  #activeMutation?: number
  #highlightedMutation?: number

  static styles = [...Element.styles, css`
    :host {
      display: flex;
      flex-direction: column;
      width: 100%;
    }
  `]

  @consume({ context })
  data: TraceLog = {} as TraceLog

  connectedCallback(): void {
    super.connectedCallback()
    this.#mutations = this.data.mutations
  }

  render() {
    if (!this.#mutations.length) {
      return html`<section class="flex items-center justify-center text-sm w-full h-full">No events logged!</section>`
    }

    return this.#mutations.map((mutation, i) => {
      return html`
        <button
          @mousemove="${() => this.#showMutationTarget(i)}"
          @click="${() => this.#selectMutation(i)}"
          class="flex items-center justify-center text-sm w-full px-4 hover:bg-toolbarHoverBackground ${this.#activeMutation === i ? 'bg-toolbarHoverBackground' : ''}"
        >
          ${this.#getMutationLabel(mutation)}
        </button>
      `
    })
  }

  #getMutationLabel(mutation: MutationRecord) {
    if (mutation.type === 'attributes') {
      return this.#getAttributeMutationLabel(mutation)
    } else if (mutation.type === 'childList') {
      return this.#getChildListMutationLabel(mutation)
    }
    return 'Unknown mutation'
  }

  #getAttributeMutationLabel(mutation: MutationRecord) {
    return html`
      <icon-mdi-pencil class="${ICON_CLASS}"></icon-mdi-pencil>
      <span class="flex-grow">${mutation.target} attribute "<code>${mutation.attributeName}</code>" changed</span>
    `
  }

  #getChildListMutationLabel(mutation: MutationRecord) {
    if (mutation.addedNodes.length === 1 && (mutation.addedNodes[0] as any).type === 'html') {
      return html`
        <icon-mdi-document class="${ICON_CLASS}"></icon-mdi-document>
        <span class="flex-grow">Document loaded</span>
      `
    }
    return html`
      <icon-mdi-family-tree class="${ICON_CLASS}"></icon-mdi-family-tree>
      <span class="flex-grow">${mutation.target} child list changed</span>
    `
  }

  #selectMutation(i: number) {
    this.#activeMutation = i
    const event = new CustomEvent('app-mutation-select', {
      detail: this.#mutations[this.#activeMutation]
    })
    window.dispatchEvent(event)
    this.requestUpdate()
  }

  #showMutationTarget(i: number) {
    if (this.#highlightedMutation === i) {
      return
    }
    this.#highlightedMutation = i
    const event = new CustomEvent('app-mutation-highlight', {
      detail: this.#mutations[i]
    })
    window.dispatchEvent(event)
  }

}

declare global {
  interface HTMLElementTagNameMap {
    [SOURCE_COMPONENT]: DevtoolsActions
  }
}
