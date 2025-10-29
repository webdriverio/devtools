import { html, nothing } from 'lit'
import { customElement, property } from 'lit/decorators.js'

import { ActionItem, ICON_CLASS } from './item.js'
import type { SimplifiedVNode } from '../../../../../script/types'

const SOURCE_COMPONENT = 'wdio-devtools-mutation-item'

@customElement(SOURCE_COMPONENT)
export class MutationItem extends ActionItem {
  @property({ type: Object })
  entry?: TraceMutation

  #getLabel(mutation: TraceMutation) {
    if (mutation.type === 'attributes') {
      return this.#getAttributeMutationLabel(mutation)
    } else if (mutation.type === 'childList') {
      return this.#getChildListMutationLabel(mutation)
    }
    return 'Unknown mutation'
  }

  #getAttributeMutationLabel(mutation: TraceMutation) {
    return html`
      <icon-mdi-pencil class="${ICON_CLASS}"></icon-mdi-pencil>
      <span class="flex-grow text-left"
        >element attribute "<code>${mutation.attributeName}</code>"
        changed</span
      >
      ${this.renderTime()}
    `
  }

  #getChildListMutationLabel(mutation: TraceMutation) {
    if (mutation.addedNodes.length === 1 && Boolean(mutation.url)) {
      return html`
        <icon-mdi-document class="${ICON_CLASS}"></icon-mdi-document>
        <span class="flex-grow text-left">Document loaded</span>
        ${this.renderTime()}
      `
    }
    return html`
      <icon-mdi-family-tree class="${ICON_CLASS}"></icon-mdi-family-tree>
      <span class="flex-grow text-left">
        ${this.#renderNodeAmount(mutation.addedNodes, 'added')}
        ${mutation.addedNodes.length && mutation.removedNodes.length
          ? ' and '
          : nothing}
        ${this.#renderNodeAmount(mutation.removedNodes, 'removed')}
      </span>
      ${this.renderTime()}
    `
  }

  #renderNodeAmount(
    nodes: (string | SimplifiedVNode)[],
    operationType: 'added' | 'removed'
  ) {
    if (!nodes.length) {
      return nothing
    }
    let nodeLabel = 'node'
    if (nodes.length > 1) {
      nodeLabel = 'nodes'
    }
    return html`${nodes.length} ${nodeLabel} ${operationType}`
  }

  #selectMutation() {
    const event = new CustomEvent('app-mutation-select', { detail: this.entry })
    window.dispatchEvent(event)
    this.requestUpdate()
  }

  #showMutationTarget() {
    const event = new CustomEvent('app-mutation-highlight', {
      detail: this.entry
    })
    window.dispatchEvent(event)
  }

  render() {
    if (!this.entry) {
      return
    }

    return html`
      <button
        @mouseenter="${() => this.#showMutationTarget()}"
        @click="${() => this.#selectMutation()}"
        class="px-1 flex items-center justify-center text-sm w-full hover:bg-toolbarHoverBackground"
      >
        ${this.#getLabel(this.entry)}
      </button>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    [SOURCE_COMPONENT]: MutationItem
  }
}
