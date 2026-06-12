import { Element } from '@core/element'
import { html, css } from 'lit'
import { customElement, state } from 'lit/decorators.js'
import { consume } from '@lit/context'

import type { CommandLog } from '@wdio/devtools-shared'
import { mutationContext, commandContext } from '../../controller/context.js'

import '../placeholder.js'
import './actionItems/command.js'
import './actionItems/mutation.js'
import { stepDurations } from './actionItems/duration.js'

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
        position: relative;
      }

      /* Vertical rail threading the action icon chips. */
      :host::before {
        content: '';
        position: absolute;
        left: 20px;
        top: 18px;
        bottom: 18px;
        width: 1px;
        background: var(--vscode-panel-border);
        pointer-events: none;
      }
    `
  ]

  @consume({ context: mutationContext, subscribe: true })
  mutations: TraceMutation[] = []

  @consume({ context: commandContext, subscribe: true })
  commands: CommandLog[] = []

  @state()
  private activeTimestamp?: number

  #onShowCommand = (event: Event) => {
    this.activeTimestamp = (
      event as CustomEvent<{ command?: CommandLog }>
    ).detail?.command?.timestamp
  }

  #onSelectMutation = (event: Event) => {
    this.activeTimestamp = (
      event as CustomEvent<TraceMutation>
    ).detail?.timestamp
  }

  connectedCallback(): void {
    super.connectedCallback()
    window.addEventListener('show-command', this.#onShowCommand)
    window.addEventListener('app-mutation-select', this.#onSelectMutation)
  }

  disconnectedCallback(): void {
    super.disconnectedCallback()
    window.removeEventListener('show-command', this.#onShowCommand)
    window.removeEventListener('app-mutation-select', this.#onSelectMutation)
  }

  render() {
    const mutations = this.mutations || []
    const commands = this.commands || []
    // Only show document-load mutations (childList with a url) in the actions
    // list — individual node add/remove mutations are too noisy.
    const visibleMutations = mutations.filter(
      (m) => m.type === 'childList' && Boolean(m.url)
    )
    const entries = [...visibleMutations, ...commands].sort(
      (a, b) => a.timestamp - b.timestamp
    )

    if (!entries.length) {
      return html`<wdio-devtools-placeholder></wdio-devtools-placeholder>`
    }
    const baselineTimestamp = entries[0]?.timestamp ?? 0
    const durations = stepDurations(entries.map((entry) => entry.timestamp))

    return entries.map((entry, index) => {
      const elapsedTime = entry.timestamp - baselineTimestamp
      const duration = durations[index]

      const active = entry.timestamp === this.activeTimestamp

      if ('command' in entry) {
        return html`
          <wdio-devtools-command-item
            elapsedTime=${elapsedTime}
            .duration=${duration}
            .entry=${entry}
            ?active=${active}
          ></wdio-devtools-command-item>
        `
      }

      return html`
        <wdio-devtools-mutation-item
          elapsedTime=${elapsedTime}
          .duration=${duration}
          .entry=${entry}
          ?active=${active}
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
