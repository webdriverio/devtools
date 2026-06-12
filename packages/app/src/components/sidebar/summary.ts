import { Element } from '@core/element'
import { html, css, nothing, type TemplateResult } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import { consume } from '@lit/context'
import type { TestStatus } from '@wdio/devtools-shared'
import { suiteContext } from '../../controller/context.js'
import type { SuiteStatsFragment } from '../../controller/types.js'
import { TestState } from './types.js'
import {
  computeSuiteSummary,
  deriveRunStatus,
  type RunStatus,
  type SuiteSummary
} from './suite-summary.js'

const SUMMARY = 'wdio-devtools-sidebar-summary'

const STATUS_LABEL: Record<RunStatus, string> = {
  running: 'Running',
  failed: 'Failed',
  passed: 'Passed',
  idle: 'Idle'
}

const STATUS_CHIPS = [
  { status: TestState.PASSED, label: 'Passed' },
  { status: TestState.FAILED, label: 'Failed' },
  { status: TestState.RUNNING, label: 'Running' },
  { status: TestState.SKIPPED, label: 'Skipped' }
] as const

@customElement(SUMMARY)
export class DevtoolsSidebarSummary extends Element {
  static styles = [
    ...Element.styles,
    css`
      :host {
        display: block;
        padding: 0 0.75rem 0.75rem;
        font-size: 0.8em;
      }

      .card {
        border: 1px solid var(--vscode-panel-border);
        border-radius: 8px;
        padding: 0.625rem 0.75rem;
        background: var(--vscode-editorWidget-background);
      }

      .row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 0.5rem;
      }

      .pill {
        display: inline-flex;
        align-items: center;
        gap: 0.375rem;
        padding: 0.125rem 0.5rem;
        border-radius: 999px;
        font-weight: 700;
        background: color-mix(in srgb, var(--status) 18%, transparent);
        color: var(--status);
      }

      .pill .dot {
        width: 7px;
        height: 7px;
        border-radius: 50%;
        background: var(--status);
      }

      :host([data-status='running']) .pill .dot {
        animation: pulse 1.6s infinite;
      }

      @keyframes pulse {
        0% {
          box-shadow: 0 0 0 0 color-mix(in srgb, var(--status) 60%, transparent);
        }
        70% {
          box-shadow: 0 0 0 7px transparent;
        }
        100% {
          box-shadow: 0 0 0 0 transparent;
        }
      }

      .count {
        color: var(--vscode-foreground);
      }
      .count b {
        font-weight: 700;
      }

      .progress {
        display: flex;
        height: 6px;
        border-radius: 999px;
        overflow: hidden;
        background: var(--vscode-panel-border);
      }
      .progress > span {
        height: 100%;
      }
      .seg-passed {
        background: var(--vscode-charts-green);
      }
      .seg-failed {
        background: var(--vscode-charts-red);
      }
      .seg-running {
        background: var(--vscode-charts-blue);
      }

      .legend {
        display: flex;
        flex-wrap: wrap;
        gap: 0.4rem 0.7rem;
        margin-top: 0.625rem;
      }
      .legend button {
        display: inline-flex;
        align-items: center;
        gap: 0.3rem;
        padding: 0;
        border: none;
        background: none;
        cursor: pointer;
        white-space: nowrap;
        font-size: inherit;
        color: var(--vscode-descriptionForeground);
        transition: color 0.12s;
      }
      .legend button:hover {
        color: var(--vscode-foreground);
      }
      .legend button[aria-pressed='true'] {
        color: var(--accent);
        font-weight: 700;
      }
      .legend i {
        width: 8px;
        height: 8px;
        border-radius: 2px;
        flex: none;
      }
      .legend .passed i {
        background: var(--vscode-charts-green);
      }
      .legend .failed i {
        background: var(--vscode-charts-red);
      }
      .legend .running i {
        background: var(--vscode-charts-blue);
      }
      .legend .skipped i {
        background: var(--vscode-charts-yellow);
      }
    `
  ]

  @consume({ context: suiteContext, subscribe: true })
  @property({ type: Array })
  suites: Record<string, SuiteStatsFragment>[] | undefined = undefined

  @state()
  private activeStatus: TestStatus | null = null

  #statusColor(status: RunStatus): string {
    switch (status) {
      case 'failed':
        return 'var(--vscode-charts-red)'
      case 'passed':
        return 'var(--vscode-charts-green)'
      case 'running':
        return 'var(--vscode-charts-blue)'
      default:
        return 'var(--vscode-descriptionForeground)'
    }
  }

  #toggleStatus(status: TestStatus): void {
    this.activeStatus = this.activeStatus === status ? null : status
    window.dispatchEvent(
      new CustomEvent('app-status-filter', {
        bubbles: true,
        composed: true,
        detail: { status: this.activeStatus }
      })
    )
  }

  #renderProgress(summary: SuiteSummary): TemplateResult {
    const pct = (n: number) => `${(n / summary.total) * 100}%`
    return html`
      <div class="progress">
        <span class="seg-passed" style="width:${pct(summary.passed)}"></span>
        <span class="seg-failed" style="width:${pct(summary.failed)}"></span>
        <span class="seg-running" style="width:${pct(summary.running)}"></span>
      </div>
    `
  }

  #renderLegend(): TemplateResult {
    return html`
      <div class="legend">
        ${STATUS_CHIPS.map(
          (chip) => html`
            <button
              class="${chip.status}"
              aria-pressed="${this.activeStatus === chip.status}"
              @click="${() => this.#toggleStatus(chip.status)}"
            >
              <i></i>${chip.label}
            </button>
          `
        )}
      </div>
    `
  }

  render() {
    const summary = computeSuiteSummary(this.suites)
    if (summary.total === 0) {
      return nothing
    }
    const status = deriveRunStatus(summary)
    this.setAttribute('data-status', status)
    this.style.setProperty('--status', this.#statusColor(status))

    return html`
      <div class="card">
        <div class="row">
          <span class="pill"
            ><span class="dot"></span>${STATUS_LABEL[status]}</span
          >
          <span class="count">
            <b>${summary.passed}</b>/${summary.total} passed
          </span>
        </div>
        ${this.#renderProgress(summary)} ${this.#renderLegend()}
      </div>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    [SUMMARY]: DevtoolsSidebarSummary
  }
}
