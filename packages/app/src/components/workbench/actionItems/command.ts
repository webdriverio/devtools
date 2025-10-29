import { html } from 'lit'
import { customElement, property } from 'lit/decorators.js'

import type { CommandLog } from '@wdio/devtools-service/types'

import { ActionItem, ICON_CLASS } from './item.js'

const SOURCE_COMPONENT = 'wdio-devtools-command-item'

@customElement(SOURCE_COMPONENT)
export class CommandItem extends ActionItem {
  @property({ type: Object, attribute: true })
  entry?: CommandLog

  #highlightLine() {
    const event = new CustomEvent('show-command', {
      detail: {
        command: this.entry,
        elapsedTime: this.elapsedTime
      }
    })
    window.dispatchEvent(event)
  }

  render() {
    if (!this.entry) {
      return
    }

    const entry = this.entry
    return html`
      <button
        class="flex px-1 w-full items-center hover:bg-toolbarHoverBackground"
        @click="${() => this.#highlightLine()}"
      >
        <icon-mdi-arrow-right class="${ICON_CLASS}"></icon-mdi-arrow-right>
        <code class="text-sm flex-wrap text-left break-all"
          >${entry.command}</code
        >
        ${this.renderTime()}
      </button>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    [SOURCE_COMPONENT]: CommandItem
  }
}
