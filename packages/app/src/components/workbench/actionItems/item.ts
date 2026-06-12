import { Element } from '@core/element'
import { html, css, type TemplateResult } from 'lit'
import { property } from 'lit/decorators.js'
import type { CommandLog } from '@wdio/devtools-shared'

import { formatDuration, durationHeat, type DurationHeat } from './duration.js'

export type ActionEntry = TraceMutation | CommandLog

/** Icon sized to sit inside the `.ic` chip rendered by `iconChip`. */
export const ICON_CLASS = 'w-[15px] h-[15px] block shrink-0'

const HEAT_CLASS: Record<DurationHeat, string> = {
  fast: 'bg-chartsGreen/10 text-chartsGreen',
  mid: 'bg-chartsYellow/10 text-chartsYellow',
  slow: 'bg-chartsRed/10 text-chartsRed'
}

export class ActionItem extends Element {
  /** Cumulative time since run start — forwarded to the `show-command` event. */
  @property({ type: Number })
  elapsedTime?: number

  /** Gap to the next action (≈ how long this step took) — drives the heat badge. */
  @property({ type: Number })
  duration?: number

  /** Whether this row is the currently selected action. */
  @property({ type: Boolean, reflect: true })
  active = false

  static styles = [
    ...Element.styles,
    css`
      :host {
        display: flex;
        flex-grow: 0;
        width: 100%;
      }

      button {
        position: relative;
      }

      .ic {
        flex: none;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 26px;
        height: 26px;
        margin: 0.25rem 0.5rem 0.25rem 0.25rem;
        border-radius: 7px;
        background: var(--vscode-editorWidget-background);
        border: 1px solid var(--vscode-panel-border);
        position: relative;
        z-index: 1;
      }

      :host([active]) button {
        background: var(--vscode-list-inactiveSelectionBackground);
        box-shadow: inset 2px 0 0 var(--accent);
      }
      :host([active]) .ic {
        border-color: var(--accent);
      }
    `
  ]

  /** Wrap an action icon in the timeline chip the connector rail threads. */
  protected iconChip(icon: TemplateResult) {
    return html`<span class="ic">${icon}</span>`
  }

  protected renderTime() {
    // Show every step (including 0ms gaps between same-timestamp commands) for
    // a consistent column; only the final action has no next-action gap.
    if (this.duration === undefined) {
      return
    }

    const heatCls = HEAT_CLASS[durationHeat(this.duration)]
    return html`
      <span
        class="text-[10px] grow-0 shrink rounded-xl ml-auto px-1.5 py-px font-medium ${heatCls}"
        >${formatDuration(this.duration)}</span
      >
    `
  }
}
