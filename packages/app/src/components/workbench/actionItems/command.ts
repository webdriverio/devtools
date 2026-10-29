import { css, html, nothing, type TemplateResult } from 'lit'
import { customElement, property } from 'lit/decorators.js'

import type { CommandLog } from '@wdio/devtools-shared'

import { ActionItem, ICON_CLASS } from './item.js'
import type { RowToggleDetail } from '../action-tree.js'
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
import '~icons/mdi/chevron-right.js'

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
  // The chevron sits over the row's button rather than inside it: a button holds no button.
  static styles = [
    ...ActionItem.styles,
    css`
      :host {
        position: relative;
      }
      button.toggle,
      :host([active]) button.toggle,
      :host([failed]) button.toggle,
      :host([failed][active]) button.toggle {
        position: absolute;
        left: 0.25rem;
        top: 0;
        bottom: 0;
        z-index: 2;
        min-height: 0;
        display: flex;
        align-items: center;
        background: none;
        box-shadow: none;
      }
      .toggle-space {
        width: 22px;
      }
    `
  ]

  @property({ type: Object, attribute: true })
  entry?: CommandLog

  /** Key a row that issued other rows (a wait's reads) toggles them by; unset on a row that issued none. */
  @property({ attribute: false })
  toggleKey?: string

  /** Whether the rows this one issued are rendered below it. */
  @property({ type: Boolean, reflect: true })
  expanded = false

  willUpdate(): void {
    this.failed = Boolean(this.entry?.error)
  }

  #highlightLine() {
    if (!this.entry) {
      return
    }
    this.requestReveal()
    window.dispatchEvent(
      // Typed as the contract, which is what makes the two nullable fields below
      // a compile error rather than a blank chip in the Log tab.
      new CustomEvent<CommandEventProps>('show-command', {
        detail: {
          command: this.entry,
          // The offset this row displays. A row that was handed none is at the
          // start of its list, so it reads zero like every other emitter's first
          // action — `undefined` would drop the Log tab's chip entirely.
          elapsedTime: this.elapsedTime ?? 0
        }
      })
    )
  }

  #toggle() {
    if (!this.toggleKey) {
      return
    }
    this.dispatchEvent(
      new CustomEvent<RowToggleDetail>('group-toggle', {
        detail: { key: this.toggleKey, expanded: this.expanded },
        bubbles: true,
        composed: true
      })
    )
  }

  // A button of its own beside the row's, so a keyboard reaches it and Enter on the row still selects.
  #renderToggle(label: string) {
    if (!this.toggleKey) {
      return
    }
    return html`<button
      class="toggle flex-none"
      aria-label="${this.expanded ? 'Collapse' : 'Expand'} ${label}"
      aria-expanded=${this.expanded ? 'true' : 'false'}
      @click=${() => this.#toggle()}
    >
      <icon-mdi-chevron-right
        class="w-[14px] h-[14px] block shrink-0 mx-1 transition-transform ${
          this.expanded ? 'rotate-90' : ''
        }"
      ></icon-mdi-chevron-right>
    </button>`
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
    const label = capitalizeAssertLabel(entry.title ?? entry.command)
    return html`
      ${this.#renderToggle(label)}
      <button
        class="flex px-1 w-full items-center hover:bg-toolbarHoverBackground"
        @click="${() => this.#highlightLine()}"
      >
        ${
          this.toggleKey
            ? html`<span class="toggle-space flex-none"></span>`
            : nothing
        }
        ${this.iconChip(this.#renderIcon(entry.command))}
        <code class="label text-[12.5px] ${this.failed ? 'text-chartsRed' : ''}"
          >${label}</code
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
