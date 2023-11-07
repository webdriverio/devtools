import { Element } from '@core/element'
import { html, css } from 'lit'
import { customElement } from 'lit/decorators.js'
import { consume } from '@lit/context'
import type { CommandLog } from '@devtools/hook/types'

import { context, type TraceLog } from '../../context.js'

import '~icons/mdi/pencil.js'
import '~icons/mdi/family-tree.js'
import '~icons/mdi/alert.js'
import '~icons/mdi/document.js'

const ICON_CLASS = 'w-[20px] h-[20px] m-1 mr-2 shrink-0'

const SOURCE_COMPONENT = 'wdio-devtools-actions'
@customElement(SOURCE_COMPONENT)
export class DevtoolsActions extends Element {
  #entries: (TraceMutation | CommandLog)[] = []
  #activeEntry?: number
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
    this.#entries = [...this.data.mutations, ...this.data.commands]
      .sort((a, b) => a.timestamp - b.timestamp)
  }

  render() {
    if (!this.#entries.length) {
      return html`<section class="flex items-center justify-center text-sm w-full h-full">No events logged!</section>`
    }

    return this.#entries.map((entry, i) => {
      if ('command' in entry) {
        return html`
          <button @click="${() => this.#highlightLine(entry.callSource)}">${entry.command}</button>
        `
      }

      return html`
        <button
          @mousemove="${() => this.#showMutationTarget(i)}"
          @click="${() => this.#selectMutation(i)}"
          class="flex items-center justify-center text-sm w-full px-4 hover:bg-toolbarHoverBackground ${this.#activeEntry === i ? 'bg-toolbarHoverBackground' : ''}"
        >
          ${this.#getMutationLabel(entry)}
        </button>
      `
    })
  }

  #getMutationLabel(mutation: TraceMutation) {
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
      <span class="flex-grow">${mutation.target} attribute "<code>${mutation.attributeName}</code>" changed</span>
    `
  }

  #getChildListMutationLabel(mutation: TraceMutation) {
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

  #highlightLine(callSource: string) {
    const event = new CustomEvent('app-source-highlight', {
      detail: callSource
    })
    window.dispatchEvent(event)
  }

  #selectMutation(i: number) {
    this.#activeEntry = i
    const event = new CustomEvent('app-mutation-select', {
      detail: this.#entries[this.#activeEntry]
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
      detail: this.#entries[i]
    })
    window.dispatchEvent(event)
  }

}

declare global {
  interface HTMLElementTagNameMap {
    [SOURCE_COMPONENT]: DevtoolsActions
  }
}
