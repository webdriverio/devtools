import { Element } from '@core/element'
import { html, css } from 'lit'
import { property } from 'lit/decorators.js'
import type { CommandLog } from '@wdio/devtools-shared'

import { formatDuration, durationHeat, type DurationHeat } from './duration.js'

export type ActionEntry = TraceMutation | CommandLog

export const ICON_CLASS = 'w-[20px] h-[20px] m-1 mr-2 shrink-0 block'

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

  static styles = [
    ...Element.styles,
    css`
      :host {
        display: flex;
        flex-grow: 0;
        width: 100%;
      }
    `
  ]

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
