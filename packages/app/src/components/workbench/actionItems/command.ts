import { html, type TemplateResult } from 'lit'
import { customElement, property } from 'lit/decorators.js'

import type { CommandLog } from '@wdio/devtools-shared'

import { ActionItem, ICON_CLASS } from './item.js'
import {
  commandCategory,
  commandIcon,
  type ActionCategory
} from './category.js'
import '~icons/mdi/arrow-top-right.js'
import '~icons/mdi/refresh.js'
import '~icons/mdi/target.js'
import '~icons/mdi/keyboard-outline.js'
import '~icons/mdi/cursor-default-click-outline.js'
import '~icons/mdi/check-circle-outline.js'
import '~icons/mdi/close-circle-outline.js'
import '~icons/mdi/text.js'
import '~icons/mdi/code-tags.js'

const SOURCE_COMPONENT = 'wdio-devtools-command-item'

function capitalizeAssertLabel(label: string): string {
  return label.replace(
    /^(assert|expect|verify)\./,
    (_m, prefix: string) =>
      prefix.charAt(0).toUpperCase() + prefix.slice(1) + '.'
  )
}

const CATEGORY_COLOR: Record<ActionCategory, string> = {
  navigation: 'text-chartsBlue',
  input: 'text-chartsPurple',
  assertion: 'text-chartsGreen',
  query: 'text-chartsYellow',
  other: ''
}

@customElement(SOURCE_COMPONENT)
export class CommandItem extends ActionItem {
  @property({ type: Object, attribute: true })
  entry?: CommandLog

  willUpdate(): void {
    this.failed = Boolean(this.entry?.error)
  }

  #highlightLine() {
    const event = new CustomEvent('show-command', {
      detail: {
        command: this.entry,
        elapsedTime: this.elapsedTime
      }
    })
    window.dispatchEvent(event)
  }

  #renderIcon(command: string): TemplateResult {
    // Failed commands render red (matching the label); a failed assertion also
    // swaps its green ✓-circle for a red ✗-circle so it never reads as passed.
    const cls = `${ICON_CLASS} ${
      this.failed ? 'text-chartsRed' : CATEGORY_COLOR[commandCategory(command)]
    }`
    const icon = commandIcon(command)
    if (this.failed && icon === 'assert') {
      return html`<icon-mdi-close-circle-outline
        class="${cls}"
      ></icon-mdi-close-circle-outline>`
    }
    switch (icon) {
      case 'navigate':
        return html`<icon-mdi-arrow-top-right
          class="${cls}"
        ></icon-mdi-arrow-top-right>`
      case 'reload':
        return html`<icon-mdi-refresh class="${cls}"></icon-mdi-refresh>`
      case 'select':
        return html`<icon-mdi-target class="${cls}"></icon-mdi-target>`
      case 'type':
        return html`<icon-mdi-keyboard-outline
          class="${cls}"
        ></icon-mdi-keyboard-outline>`
      case 'click':
        return html`<icon-mdi-cursor-default-click-outline
          class="${cls}"
        ></icon-mdi-cursor-default-click-outline>`
      case 'assert':
        return html`<icon-mdi-check-circle-outline
          class="${cls}"
        ></icon-mdi-check-circle-outline>`
      case 'read':
        return html`<icon-mdi-text class="${cls}"></icon-mdi-text>`
      default:
        return html`<icon-mdi-code-tags class="${cls}"></icon-mdi-code-tags>`
    }
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
        ${this.iconChip(this.#renderIcon(entry.command))}
        <code
          class="text-[12.5px] flex-wrap text-left break-all ${this.failed
            ? 'text-chartsRed'
            : ''}"
          >${capitalizeAssertLabel(entry.title ?? entry.command)}</code
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
