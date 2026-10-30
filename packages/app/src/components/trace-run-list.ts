import { Element } from '@core/element'
import { html, css, nothing } from 'lit'
import { customElement, property } from 'lit/decorators.js'

import { TRACE_RUN_SELECT_EVENT } from '../controller/constants.js'
import type { TraceRunEntry } from '../controller/trace-run.js'
import { TRACE_OUTCOME } from '../utils/trace-summary.js'
import {
  stateIcon,
  STATE_ICON_STYLES,
  type StateIconKind
} from './sidebar/state-icon.js'

const OUTCOME_ICON: Record<string, StateIconKind> = {
  [TRACE_OUTCOME.PASSED]: 'passed',
  [TRACE_OUTCOME.FAILED]: 'failed',
  [TRACE_OUTCOME.UNKNOWN]: 'idle'
}

const OUTCOME_NOTE: Record<string, string> = {
  [TRACE_OUTCOME.PASSED]: 'Passed: no action in this trace failed',
  [TRACE_OUTCOME.FAILED]: 'Failed: an action in this trace failed',
  [TRACE_OUTCOME.UNKNOWN]: 'Outcome unknown: this trace records no actions'
}

function iconOf(entry: TraceRunEntry): StateIconKind {
  if (entry.status === 'pending') {
    return 'running'
  }
  return entry.status === 'error'
    ? 'unreadable'
    : OUTCOME_ICON[entry.summary.outcome]
}

function nameOf(entry: TraceRunEntry): string {
  const path = entry.status === 'ready' ? entry.summary.titlePath : undefined
  return path?.[path.length - 1] ?? entry.label
}

function detailOf(entry: TraceRunEntry): string {
  return entry.status === 'error'
    ? `Could not open: ${entry.error}`
    : entry.path
}

function tooltipOf(entry: TraceRunEntry): string {
  if (entry.status === 'pending') {
    return `${entry.path}\nOpening…`
  }
  if (entry.status === 'error') {
    return `${entry.path}\nCould not open: ${entry.error}`
  }
  const title = entry.summary.titlePath?.join(' › ') ?? entry.label
  return `${title}\n${entry.path}\n${OUTCOME_NOTE[entry.summary.outcome]}`
}

/** The traces of an opened run, one row each with its outcome; picking a row plays it. */
@customElement('wdio-devtools-trace-run-list')
export class DevtoolsTraceRunList extends Element {
  @property({ attribute: false }) entries: readonly TraceRunEntry[] = []
  @property({ type: Number }) selectedId?: number

  static styles = [
    ...Element.styles,
    STATE_ICON_STYLES,
    css`
      :host {
        flex-shrink: 0;
        box-sizing: border-box;
        display: flex;
        flex-direction: column;
        height: 100%;
        min-height: 0;
        min-width: 0;
        overflow: hidden;
        color: var(--vscode-foreground);
        background-color: var(--vscode-sideBar-background);
        border-right: 1px solid var(--vscode-panel-border) !important;
      }

      .summary {
        color: var(--vscode-descriptionForeground);
      }

      .row[aria-current='true'] {
        background: color-mix(in srgb, var(--accent) 14%, transparent);
        box-shadow: inset 2px 0 0 var(--accent);
      }

      .row[aria-disabled='true'] {
        cursor: default;
      }

      .row:focus-visible {
        outline: 1px solid var(--accent);
        outline-offset: -1px;
      }

      .name,
      .detail {
        display: block;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        line-height: 18px;
      }

      .name.failed,
      .name.unreadable {
        color: var(--vscode-charts-red);
      }

      .row[aria-current='true'] .name {
        color: var(--vscode-foreground);
      }

      .detail {
        font-size: 11px;
        color: var(--vscode-descriptionForeground);
      }
    `
  ]

  #summary(): string {
    const total = this.entries.length
    const pending = this.entries.filter((e) => e.status === 'pending').length
    if (pending) {
      return `Opening ${total - pending + 1} of ${total}`
    }
    const failed = this.entries.filter(
      (e) => e.status === 'ready' && e.summary.outcome === TRACE_OUTCOME.FAILED
    ).length
    const unreadable = this.entries.filter((e) => e.status === 'error').length
    return [
      `${total} traces`,
      failed ? `${failed} failed` : '',
      unreadable ? `${unreadable} could not open` : ''
    ]
      .filter(Boolean)
      .join(' · ')
  }

  #select(entry: TraceRunEntry) {
    if (entry.status !== 'ready') {
      return
    }
    this.dispatchEvent(
      new CustomEvent<number>(TRACE_RUN_SELECT_EVENT, {
        detail: entry.id,
        bubbles: true,
        composed: true
      })
    )
  }

  // Handled here so Space picks a row instead of reaching the player's play/pause.
  #onKeyDown(event: KeyboardEvent, entry: TraceRunEntry) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      this.#select(entry)
      return
    }
    const step = { ArrowDown: 1, ArrowUp: -1 }[event.key]
    if (!step) {
      return
    }
    event.preventDefault()
    const rows = [...this.renderRoot.querySelectorAll<HTMLElement>('.row')]
    const at = rows.indexOf(event.currentTarget as HTMLElement)
    rows[Math.min(rows.length - 1, Math.max(0, at + step))]?.focus()
  }

  #row(entry: TraceRunEntry) {
    const icon = iconOf(entry)
    return html`<li>
      <button
        class="row flex w-full items-start gap-2 text-left text-sm rounded-md my-0.5 px-2 py-1 cursor-pointer hover:bg-toolbarHoverBackground"
        aria-current="${entry.id === this.selectedId ? 'true' : 'false'}"
        aria-disabled="${entry.status === 'ready' ? 'false' : 'true'}"
        title="${tooltipOf(entry)}"
        @click="${() => this.#select(entry)}"
        @keydown="${(event: KeyboardEvent) => this.#onKeyDown(event, entry)}"
      >
        ${stateIcon(icon)}
        <span class="min-w-0 flex-1">
          <span class="name ${icon}">${nameOf(entry)}</span>
          <span class="detail">${detailOf(entry)}</span>
        </span>
      </button>
    </li>`
  }

  render() {
    if (!this.entries.length) {
      return nothing
    }
    return html`
      <header class="px-3 pt-3 pb-2">
        <h2 class="text-sm font-semibold">Traces</h2>
        <p class="summary text-xs" role="status">${this.#summary()}</p>
      </header>
      <ul class="flex-1 min-h-0 overflow-y-auto px-1 pb-2" aria-label="Traces">
        ${this.entries.map((entry) => this.#row(entry))}
      </ul>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'wdio-devtools-trace-run-list': DevtoolsTraceRunList
  }
}
