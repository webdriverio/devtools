import { Element } from '@core/element'
import { html, css } from 'lit'
import { customElement } from 'lit/decorators.js'
import { consume } from '@lit/context'

import { context, type TraceLog } from '../../context.js'
import { type ActionEntry } from './actionItems/item.js'

import '~icons/mdi/pencil.js'
import '~icons/mdi/family-tree.js'
import '~icons/mdi/alert.js'
import '~icons/mdi/document.js'
import '~icons/mdi/arrow-right.js'

import './actionItems/command.js'
import './actionItems/mutation.js'

const SOURCE_COMPONENT = 'wdio-devtools-actions'

@customElement(SOURCE_COMPONENT)
export class DevtoolsActions extends Element {
  #entries: ActionEntry[] = []

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

    return this.#entries.map((entry) => {
      const elapsedTime = entry.timestamp - this.data.mutations[0].timestamp

      if ('command' in entry) {
        return html`
          <wdio-devtools-command-item
            elapsedTime=${elapsedTime}
            .entry=${entry}
          ></wdio-devtools-command-item>
        `
      }

      return html`
        <wdio-devtools-mutation-item
          elapsedTime=${elapsedTime}
          .entry=${entry}
        ></wdio-devtools-mutation-item>
      `
    })
  }
}

declare global {
  interface HTMLElementTagNameMap {
    [SOURCE_COMPONENT]: DevtoolsActions
  }
}
