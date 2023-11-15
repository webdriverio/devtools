import { Element } from '@core/element'
import { html, css, nothing } from 'lit'
import { customElement } from 'lit/decorators.js'
import { consume } from '@lit/context'
import type { CommandLog } from '@wdio/devtools-hook/types'

import { context, type TraceLog } from '../../context.js'

import '~icons/mdi/pencil.js'
import '~icons/mdi/family-tree.js'
import '~icons/mdi/alert.js'
import '~icons/mdi/document.js'
import '~icons/mdi/arrow-right.js'

type ActionEntry = TraceMutation | CommandLog

const ONE_MINUTE = 1000 * 60
const ICON_CLASS = 'w-[20px] h-[20px] m-1 mr-2 shrink-0 block'
const SOURCE_COMPONENT = 'wdio-devtools-actions'

@customElement(SOURCE_COMPONENT)
export class DevtoolsActions extends Element {
  #entries: ActionEntry[] = []
  #activeEntry?: number
  #highlightedMutation?: number

  static styles = [...Element.styles, css`
    :host {
      display: flex;
      flex-direction: column;
      width: 100%;
    }
  `]

  get mutationEntries () {
    return this.#entries.filter((entry) => !('command' in entry)) as TraceMutation[]
  }

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
          <button class="flex px-2 items-center" @click="${() => this.#highlightLine(entry.callSource)}">
            <icon-mdi-arrow-right class="${ICON_CLASS}"></icon-mdi-arrow-right>
            ${this.#renderTime(entry)}
            <code class="text-sm flex-wrap text-left break-all">${entry.command}(${entry.args.map((arg) => JSON.stringify(arg, null, 2)).join(', ')})</code>
          </button>
        `
      }

      return html`
        <button
          @mousemove="${() => this.#showMutationTarget(i)}"
          @click="${() => this.#selectMutation(this.mutationEntries.indexOf(entry), i)}"
          class="flex items-center justify-center text-sm w-full px-2 hover:bg-toolbarHoverBackground ${this.#activeEntry === i ? 'bg-toolbarHoverBackground' : ''}"
        >
          ${this.#getMutationLabel(entry)}
        </button>
      `
    })
  }

  #renderTime (entry: ActionEntry) {
    const diff = entry.timestamp - this.data.mutations[0].timestamp
    let diffLabel = `${diff}ms`
    if (diff > 1000) {
      diffLabel = `${(diff / 1000).toFixed(2)}s`
    }
    if (diff > ONE_MINUTE) {
      const minutes = Math.floor(diff / 1000 / 60)
      diffLabel = `${minutes}m ${Math.floor((diff - minutes * ONE_MINUTE) / 1000)}s`
    }

    return html`
      <span class="text-xs text-gray-500 shrink-0 pr-2 text-debugTokenExpressionName">${diffLabel}</span>
    `
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
      ${this.#renderTime(mutation)}
      <span class="flex-grow text-left">element attribute "<code>${mutation.attributeName}</code>" changed</span>
    `
  }

  #getChildListMutationLabel(mutation: TraceMutation) {
    if (mutation.addedNodes.length === 1 && (mutation.addedNodes[0] as any).type === 'html') {
      return html`
        <icon-mdi-document class="${ICON_CLASS}"></icon-mdi-document>
        ${this.#renderTime(mutation)}
        <span class="flex-grow text-left">Document loaded</span>
      `
    }
    return html`
      <icon-mdi-family-tree class="${ICON_CLASS}"></icon-mdi-family-tree>
      ${this.#renderTime(mutation)}
      <span class="flex-grow text-left">
        ${this.#renderNodeAmount(mutation.addedNodes, 'added')}
        ${mutation.addedNodes.length && mutation.removedNodes.length
          ? ' and '
          : nothing}
        ${this.#renderNodeAmount(mutation.removedNodes, 'removed')}
      </span>
    `
  }

  #renderNodeAmount (nodes: (string | SimplifiedVNode)[], operationType: 'added' | 'removed') {
    if (!nodes.length) {
      return nothing
    }
    let nodeLabel = 'node'
    if (nodes.length > 1) {
      nodeLabel = 'nodes'
    }
    return html`${nodes.length} ${nodeLabel} ${operationType}`
  }

  #highlightLine(callSource: string) {
    const event = new CustomEvent('app-source-highlight', {
      detail: callSource
    })
    window.dispatchEvent(event)
  }

  #selectMutation(detail: number, listIndex: number) {
    this.#activeEntry = listIndex
    const event = new CustomEvent('app-mutation-select', { detail })
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
