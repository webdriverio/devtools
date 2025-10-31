import { Element } from '@core/element'
import { html, css } from 'lit'
import { property } from 'lit/decorators.js'
import type { CommandLog } from '@wdio/devtools-service/types'

export type ActionEntry = TraceMutation | CommandLog

export const ICON_CLASS = 'w-[20px] h-[20px] m-1 mr-2 shrink-0 block'

const ONE_MINUTE = 1000 * 60

export class ActionItem extends Element {
  @property({ type: Number })
  elapsedTime?: number

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
    if (!this.elapsedTime) {
      return
    }

    let diffLabel = `${this.elapsedTime}ms`
    if (this.elapsedTime > 1000) {
      diffLabel = `${(this.elapsedTime / 1000).toFixed(2)}s`
    }
    if (this.elapsedTime > ONE_MINUTE) {
      const minutes = Math.floor(this.elapsedTime / 1000 / 60)
      diffLabel = `${minutes}m ${Math.floor((this.elapsedTime - minutes * ONE_MINUTE) / 1000)}s`
    }

    return html`
      <span
        class="text-[10px] grow-0 shrink border border-editorSuggestWidgetBorder rounded-xl ml-auto text-gray-500 px-1 text-debugTokenExpressionName"
        >${diffLabel}</span
      >
    `
  }
}
