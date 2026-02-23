import { Element } from '@core/element'
import { html, css } from 'lit'
import { customElement } from 'lit/decorators.js'
import { consume } from '@lit/context'

import {
  mutationContext,
  type TraceMutation,
  commandContext,
  type CommandLog
} from '../../controller/DataManager.js'

import '~icons/mdi/pencil.js'
import '~icons/mdi/family-tree.js'
import '~icons/mdi/alert.js'
import '~icons/mdi/document.js'
import '~icons/mdi/arrow-right.js'

import '../placeholder.js'
import './actionItems/command.js'
import './actionItems/mutation.js'

const SOURCE_COMPONENT = 'wdio-devtools-actions'

@customElement(SOURCE_COMPONENT)
export class DevtoolsActions extends Element {
  static styles = [
    ...Element.styles,
    css`
      :host {
        display: flex;
        flex-direction: column;
        width: 100%;
      }
    `
  ]

  @consume({ context: mutationContext, subscribe: true })
  mutations: TraceMutation[] = []

  @consume({ context: commandContext, subscribe: true })
  commands: CommandLog[] = []

  render() {
    const mutations = this.mutations || []
    const commands = this.commands || []
    const entries = [...mutations, ...commands].sort(
      (a, b) => a.timestamp - b.timestamp
    )

    if (!entries.length) {
      return html`<wdio-devtools-placeholder></wdio-devtools-placeholder>`
    }
    const baselineTimestamp = entries[0]?.timestamp ?? 0

    return entries.map((entry) => {
      const elapsedTime = entry.timestamp - baselineTimestamp

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
