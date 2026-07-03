import { html } from 'lit'
import { customElement, property } from 'lit/decorators.js'

import type { TraceActionGroupNode } from '@wdio/devtools-shared'

import { ActionItem } from './item.js'
import '~icons/mdi/chevron-right.js'

const SOURCE_COMPONENT = 'wdio-devtools-group-item'

/** Collapsible step/group row of the trace player's action tree. */
@customElement(SOURCE_COMPONENT)
export class GroupItem extends ActionItem {
  @property({ type: Object })
  group?: TraceActionGroupNode

  /** Whether the group's children are currently rendered below it. */
  @property({ type: Boolean, reflect: true })
  expanded = false

  willUpdate(): void {
    this.failed = Boolean(this.group?.failed)
    this.duration = this.group
      ? this.group.endTime - this.group.startTime
      : undefined
  }

  #toggle() {
    this.dispatchEvent(
      new CustomEvent('group-toggle', {
        detail: { callId: this.group?.callId, expanded: this.expanded },
        bubbles: true,
        composed: true
      })
    )
  }

  render() {
    if (!this.group) {
      return
    }
    return html`
      <button
        class="flex px-1 py-0.5 w-full items-center hover:bg-toolbarHoverBackground"
        @click="${() => this.#toggle()}"
      >
        <icon-mdi-chevron-right
          class="w-[14px] h-[14px] block shrink-0 mx-1 transition-transform ${this
            .expanded
            ? 'rotate-90'
            : ''}"
        ></icon-mdi-chevron-right>
        <span
          class="text-[12.5px] font-medium text-left break-all ${this.failed
            ? 'text-chartsRed'
            : ''}"
          >${this.group.title}</span
        >
        ${this.renderTime()}
      </button>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    [SOURCE_COMPONENT]: GroupItem
  }
}
