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
import { activeTimestampAt } from './active-entry.js'

type TimelineEntry = TraceMutation | CommandLog

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

      /* Wraps the rows so the rail spans the full content height — the host
         itself is stretched to the viewport by the row-flex tab. */
      .timeline {
        position: relative;
        display: flex;
        flex-direction: column;
        padding: 8px 8px 12px;
      }

      /* Vertical rail threading the action icon chips. */
      .timeline::before {
        content: '';
        position: absolute;
        left: 28px;
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

  // The selected timeline row, tracked by object reference — timestamps aren't
  // unique (commands logged in the same millisecond would all match), so
  // reference identity is what highlights exactly one row.
  @state()
  private activeEntry?: TimelineEntry

  #onShowCommand = (event: Event) => {
    const command = (event as CustomEvent<{ command?: CommandLog }>).detail
      ?.command
    this.activeEntry = command
    // Follow the call site in the Source editor passively — the Log tab is what
    // surfaces on a command click, so stealing focus to Source would flash.
    if (command?.callSource) {
      window.dispatchEvent(
        new CustomEvent('app-source-track', {
          detail: { callSource: command.callSource }
        })
      )
    }
  }

  #onSelectMutation = (event: Event) => {
    this.activeEntry = (event as CustomEvent<TraceMutation>).detail
  }

  // Screencast playback drives the highlight to the action at the current frame.
  // Only acts when the active action changes, so the editor isn't re-scrolled on
  // every timeupdate tick.
  #onScreencastProgress = (event: Event) => {
    const { time } = (event as CustomEvent<{ time: number }>).detail
    const entries = this.#sortedEntries()
    const timestamp = activeTimestampAt(
      entries.map((entry) => entry.timestamp),
      time
    )
    const active = entries.find((entry) => entry.timestamp === timestamp)
    if (active === this.activeEntry) {
      return
    }
    this.activeEntry = active
    if (active && 'command' in active && active.callSource) {
      window.dispatchEvent(
        new CustomEvent('app-source-track', {
          detail: { callSource: active.callSource }
        })
      )
    }
  }

  connectedCallback(): void {
    super.connectedCallback()
    window.addEventListener('show-command', this.#onShowCommand)
    window.addEventListener('app-mutation-select', this.#onSelectMutation)
    window.addEventListener(
      'app-screencast-progress',
      this.#onScreencastProgress
    )
  }

  disconnectedCallback(): void {
    super.disconnectedCallback()
    window.removeEventListener('show-command', this.#onShowCommand)
    window.removeEventListener('app-mutation-select', this.#onSelectMutation)
    window.removeEventListener(
      'app-screencast-progress',
      this.#onScreencastProgress
    )
  }

  // Mutations + commands merged and ordered by time — the timeline's rows.
  // Only document-load mutations (childList with a url) are shown; individual
  // node add/remove mutations are too noisy.
  #sortedEntries(): TimelineEntry[] {
    const visibleMutations = (this.mutations || []).filter(
      (m) => m.type === 'childList' && Boolean(m.url)
    )
    return [...visibleMutations, ...(this.commands || [])].sort(
      (a, b) => a.timestamp - b.timestamp
    )
  }

  // Keep the action that's playing in view as the screencast scrubs.
  updated(changed: Map<string, unknown>): void {
    if (changed.has('activeEntry') && this.activeEntry !== undefined) {
      this.renderRoot
        .querySelector('[active]')
        ?.scrollIntoView({ block: 'nearest' })
    }
  }

  render() {
    const entries = this.#sortedEntries()

    if (!entries.length) {
      return html`<wdio-devtools-placeholder></wdio-devtools-placeholder>`
    }
    const baselineTimestamp = entries[0]?.timestamp ?? 0
    const durations = stepDurations(entries.map((entry) => entry.timestamp))

    const rows = entries.map((entry, index) => {
      const elapsedTime = entry.timestamp - baselineTimestamp
      const duration = durations[index]
      const active = entry === this.activeEntry

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

    return html`<div class="timeline">${rows}</div>`
  }
}

declare global {
  interface HTMLElementTagNameMap {
    [SOURCE_COMPONENT]: DevtoolsActions
  }
}
