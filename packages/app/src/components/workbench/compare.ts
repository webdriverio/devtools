import { Element } from '@core/element'
import { html, css, nothing } from 'lit'
import { customElement, state } from 'lit/decorators.js'
import { consume } from '@lit/context'

import type {
  CommandLog,
  PreservedAttempt,
  PreservedStep
} from '@wdio/devtools-service/types'
import {
  baselineContext,
  selectedTestUidContext,
  commandContext,
  consoleLogContext,
  networkRequestContext,
  suiteContext
} from '../../controller/context.js'
import type { SuiteStatsFragment } from '../../controller/types.js'
import {
  pairSteps,
  classifyDivergence,
  type ComparePairedStep,
  type DivergenceKind
} from './compare/compareUtils.js'

const COMPONENT = 'wdio-devtools-compare'

@customElement(COMPONENT)
export class DevtoolsCompare extends Element {
  static styles = [
    ...Element.styles,
    css`
      :host {
        display: flex;
        flex-direction: column;
        width: 100%;
        height: 100%;
        min-height: 0;
        overflow: hidden;
      }
      .compare-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 0;
        flex: 1 1 auto;
        min-height: 0;
        overflow: auto;
      }
      .step-row {
        display: contents;
      }
      .step-cell {
        padding: 0.25rem 0.5rem;
        border-bottom: 1px solid var(--vscode-panel-border, #2a2a2a);
        font-family: var(--vscode-editor-font-family, monospace);
        font-size: 0.85em;
        cursor: pointer;
      }
      .step-cell.divergent {
        background: rgba(255, 90, 90, 0.08);
      }
      .step-cell.divergent.first {
        background: rgba(255, 90, 90, 0.18);
        border-left: 3px solid var(--vscode-charts-red, #f48771);
      }
      .marker {
        margin-left: 0.35rem;
        font-size: 0.85em;
      }
      .marker.result {
        color: var(--vscode-charts-orange, #d19a66);
      }
      .marker.error {
        color: var(--vscode-charts-red, #f48771);
      }
      .marker.command {
        color: var(--vscode-charts-red, #f48771);
      }
      .marker.ok {
        color: var(--vscode-charts-green, #73c373);
      }
      .error-banner {
        margin: 0.5rem 0.75rem;
        padding: 0.5rem 0.75rem;
        background: rgba(244, 135, 113, 0.12);
        border-left: 3px solid var(--vscode-charts-red, #f48771);
        border-radius: 3px;
        font-size: 0.85em;
        font-family: var(--vscode-editor-font-family, monospace);
        white-space: pre-wrap;
        word-break: break-word;
      }
      .error-banner-title {
        font-weight: 600;
        margin-bottom: 0.25rem;
        opacity: 0.85;
      }
      .step-cell.missing {
        opacity: 0.35;
        font-style: italic;
      }
      .step-cell:hover {
        background: var(--vscode-toolbar-hoverBackground, rgba(255, 255, 255, 0.06));
      }
      .step-cell.expanded {
        background: rgba(80, 160, 255, 0.06);
      }
      .pill {
        display: inline-flex;
        align-items: center;
        gap: 0.25rem;
        padding: 0.1rem 0.5rem;
        border-radius: 4px;
        font-size: 0.85em;
        background: var(--vscode-badge-background, #2a2a2a);
      }
      .pill.failed {
        background: rgba(244, 135, 113, 0.2);
        color: var(--vscode-charts-red, #f48771);
      }
      .pill.passed {
        background: rgba(115, 195, 115, 0.2);
        color: var(--vscode-charts-green, #73c373);
      }
      .topbar {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.5rem 0.75rem;
        border-bottom: 1px solid var(--vscode-panel-border, #2a2a2a);
        flex: 0 0 auto;
      }
      .col-header {
        position: sticky;
        top: 0;
        background: var(--vscode-editor-background, #1e1e1e);
        z-index: 1;
        padding: 0.5rem;
        font-weight: 600;
        font-size: 0.85em;
        border-bottom: 1px solid var(--vscode-panel-border, #2a2a2a);
      }
      .detail-panel {
        grid-column: span 2;
        background: var(--vscode-editor-background, #1e1e1e);
        border-bottom: 1px solid var(--vscode-panel-border, #2a2a2a);
        padding: 0.5rem;
      }
      .detail-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 0.75rem;
      }
      .detail-block {
        font-size: 0.85em;
      }
      .detail-block h4 {
        font-size: 0.85em;
        margin: 0 0 0.25rem;
        opacity: 0.7;
        font-weight: 600;
      }
      .detail-block pre {
        margin: 0;
        white-space: pre-wrap;
        word-break: break-word;
        font-size: 0.85em;
        background: rgba(255, 255, 255, 0.03);
        padding: 0.25rem 0.4rem;
        border-radius: 3px;
      }
      .empty-state {
        flex: 1;
        display: flex;
        align-items: center;
        justify-content: center;
        color: var(--vscode-descriptionForeground, #888);
        font-size: 0.9em;
        text-align: center;
        padding: 1rem;
      }
      .toggle-label {
        display: inline-flex;
        align-items: center;
        gap: 0.35rem;
        cursor: pointer;
        font-size: 0.85em;
      }
      button.action {
        background: transparent;
        border: 1px solid var(--vscode-panel-border, #2a2a2a);
        color: inherit;
        padding: 0.2rem 0.5rem;
        border-radius: 3px;
        cursor: pointer;
        font-size: 0.85em;
      }
      button.action:hover {
        background: var(--vscode-toolbar-hoverBackground, rgba(255, 255, 255, 0.06));
      }
    `
  ]

  @consume({ context: baselineContext, subscribe: true })
  @state()
  baselines: Map<string, PreservedAttempt> | undefined = undefined

  @consume({ context: selectedTestUidContext, subscribe: true })
  @state()
  selectedTestUid: string | undefined = undefined

  @consume({ context: commandContext, subscribe: true })
  @state()
  liveCommands: CommandLog[] | undefined = undefined

  @consume({ context: consoleLogContext, subscribe: true })
  @state()
  liveConsoleLogs: ConsoleLogs[] | undefined = undefined

  @consume({ context: networkRequestContext, subscribe: true })
  @state()
  liveNetwork: NetworkRequest[] | undefined = undefined

  @consume({ context: suiteContext, subscribe: true })
  @state()
  liveSuites: Record<string, SuiteStatsFragment>[] | undefined = undefined

  @state()
  swapped = false

  @state()
  differencesOnly = false

  @state()
  expandedIndex: number | null = null

  #autoScrolledForUid: string | null = null

  updated() {
    // Autoscroll to the first divergent row when a new baseline appears.
    if (
      this.selectedTestUid &&
      this.#autoScrolledForUid !== this.selectedTestUid
    ) {
      const target = this.renderRoot.querySelector(
        '[data-first-divergent="true"]'
      )
      if (target) {
        target.scrollIntoView({ block: 'center', behavior: 'smooth' })
        this.#autoScrolledForUid = this.selectedTestUid
      }
    }
  }

  #getBaseline(): PreservedAttempt | undefined {
    if (!this.selectedTestUid) {
      return undefined
    }
    return this.baselines?.get(this.selectedTestUid)
  }

  /**
   * Derive the latest run's step list from the live suite tree, so the
   * Compare tab can attribute live commands to their parent step on the
   * latest side just as the baseline does on its frozen snapshot.
   * Walks the subtree rooted at selectedTestUid and collects leaf tests.
   */
  #liveStepsForSelectedUid(): PreservedStep[] {
    const target = this.selectedTestUid
    if (!target || !this.liveSuites) {
      return []
    }
    const out: PreservedStep[] = []
    let foundRoot: SuiteStatsFragment | undefined
    const findRoot = (
      s: SuiteStatsFragment | undefined
    ): SuiteStatsFragment | undefined => {
      if (!s) return undefined
      if (s.uid === target) return s
      for (const child of s.suites ?? []) {
        const hit = findRoot(child)
        if (hit) return hit
      }
      return undefined
    }
    for (const chunk of this.liveSuites) {
      for (const root of Object.values(chunk)) {
        foundRoot = findRoot(root)
        if (foundRoot) break
      }
      if (foundRoot) break
    }
    if (!foundRoot) {
      return []
    }
    const visit = (s: SuiteStatsFragment) => {
      for (const t of s.tests ?? []) {
        out.push({
          uid: t.uid,
          title: t.title,
          fullTitle: t.fullTitle,
          start: t.start ? new Date(t.start).getTime() : undefined,
          end: t.end ? new Date(t.end).getTime() : undefined,
          state:
            t.state === 'pending' || t.state === 'running'
              ? t.state
              : t.state,
          error: t.error
            ? { message: t.error.message, name: t.error.name, stack: t.error.stack }
            : undefined
        })
      }
      for (const child of s.suites ?? []) {
        visit(child)
      }
    }
    visit(foundRoot)
    return out
  }

  #findStepFor(
    cmd: CommandLog | undefined,
    side: 'baseline' | 'latest'
  ): PreservedStep | undefined {
    if (!cmd?.timestamp) return undefined
    const steps =
      side === 'baseline'
        ? this.#getBaseline()?.steps ?? []
        : this.#liveStepsForSelectedUid()
    const ts = cmd.timestamp
    return steps.find(
      (s) =>
        s.start != null &&
        s.end != null &&
        ts >= s.start &&
        ts <= s.end
    )
  }

  async #clearBaseline() {
    if (!this.selectedTestUid) {
      return
    }
    try {
      await fetch('/api/baseline/clear', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ testUid: this.selectedTestUid })
      })
    } catch {
      // best-effort; the server broadcast updates the context.
    }
  }

  render() {
    const baseline = this.#getBaseline()
    if (!baseline) {
      return html`
        <div class="empty-state">
          <div>
            <p>No baseline preserved.</p>
            <p>
              Click the
              <strong>📌 Preserve &amp; Rerun</strong> button on a failed test
              to compare the failing run against the rerun.
            </p>
          </div>
        </div>
      `
    }

    const baselineCommands = baseline.commands as CommandLog[]
    const latestCommands = (this.liveCommands || []) as CommandLog[]

    // Naming follows physical sides (left/right) after swap.
    const leftAttempt = this.swapped ? null : baseline
    const rightAttempt = this.swapped ? baseline : null
    const leftCommands = this.swapped ? latestCommands : baselineCommands
    const rightCommands = this.swapped ? baselineCommands : latestCommands

    const pairs = pairSteps(baselineCommands, latestCommands)
    const visiblePairs = this.differencesOnly
      ? pairs.filter((p) => p.divergent || !p.baseline || !p.latest)
      : pairs
    const firstDivergent = pairs.findIndex((p) => p.divergent)

    const errorMessage = baseline.test.error?.message
    return html`
      <div class="topbar">
        <span class="pill ${baseline.test.state || ''}">
          Baseline · ${baseline.test.state || 'unknown'} ·
          ${baselineCommands.length} commands
        </span>
        <span>⇄</span>
        <span class="pill">
          Latest · ${latestCommands.length} commands
        </span>
        <span style="opacity:0.6; font-size:0.85em;">
          ${baseline.scope === 'suite' ? 'suite scope' : 'test scope'}
        </span>
        <label class="toggle-label" style="margin-left:auto;">
          <input
            type="checkbox"
            .checked=${this.differencesOnly}
            @change="${(e: Event) =>
              (this.differencesOnly = (e.target as HTMLInputElement).checked)}"
          />
          Differences only
        </label>
        <button
          class="action"
          @click="${() => (this.swapped = !this.swapped)}"
          title="Swap sides"
        >
          Swap
        </button>
        <button
          class="action"
          @click="${() => this.#clearBaseline()}"
          title="Drop this baseline"
        >
          Clear
        </button>
      </div>
      ${errorMessage
        ? html`
            <div class="error-banner">
              <div class="error-banner-title">
                Why the baseline failed
              </div>
              ${errorMessage}
            </div>
          `
        : nothing}
      <div class="compare-grid">
        <div class="col-header">
          ${this.swapped ? 'Latest' : 'Baseline'}
        </div>
        <div class="col-header">
          ${this.swapped ? 'Baseline' : 'Latest'}
        </div>
        ${visiblePairs.map((pair) => this.#renderPair(
          pair,
          leftCommands,
          rightCommands,
          firstDivergent
        ))}
      </div>
      ${leftAttempt || rightAttempt ? nothing : nothing}
    `
  }

  #renderPair(
    pair: ComparePairedStep,
    leftCommands: CommandLog[],
    rightCommands: CommandLog[],
    firstDivergent: number
  ) {
    const isFirstDivergent = pair.index === firstDivergent
    const expanded = this.expandedIndex === pair.index
    const left = leftCommands[pair.index]
    const right = rightCommands[pair.index]

    // Classify divergence ONCE so left and right rows share the same label.
    // The kind tells the user *why* this row diverged — different command
    // (execution forked), WebDriver error on one side, or one side has no
    // command at this index. We deliberately don't compare raw results —
    // WebDriver element refs (W3C element-id keys) change every session and
    // would create false positives. Assertion failures are surfaced instead
    // by step-level markers (see below).
    const kind: DivergenceKind = classifyDivergence(left, right)
    const stepFor = (cmd: CommandLog | undefined, side: 'baseline' | 'latest') =>
      this.#findStepFor(cmd, side)
    const marker = (cmd: CommandLog | undefined, side: 'baseline' | 'latest') => {
      if (!cmd) {
        return nothing
      }
      // Row-level divergence first — these are the strongest signals.
      switch (kind) {
        case 'command':
          return html`<span class="marker command" title="Different command or arguments"
            >≠ call</span
          >`
        case 'error':
          return html`<span class="marker error" title="WebDriver error differs"
            >⚠ error</span
          >`
        case 'missing':
          return html`<span class="marker error" title="Only one side has this step"
            >∅ missing</span
          >`
      }
      // Same WebDriver-level call on both sides — fall back to step-level
      // pass/fail so the failed step's commands (the assertion site) are
      // still visible. The getText command itself succeeds even when the
      // toHaveText assertion afterwards fails; this surfaces that.
      const step = stepFor(cmd, side)
      if (step?.state === 'failed') {
        const tooltip = step.error?.message
          ? `Failed step: ${step.fullTitle || step.title || step.uid}\n${step.error.message}`
          : `Failed step: ${step.fullTitle || step.title || step.uid}`
        return html`<span class="marker error" title="${tooltip}">✗ in failed step</span>`
      }
      if (step?.state === 'passed') {
        return html`<span class="marker ok" title="Step passed: ${step.fullTitle || step.title || step.uid}">✓</span>`
      }
      return html`<span class="marker ok" title="Identical">✓</span>`
    }

    const cellClass = (cmd: CommandLog | undefined) => {
      const cls = ['step-cell']
      if (!cmd) {
        cls.push('missing')
      }
      if (pair.divergent) {
        cls.push('divergent')
      }
      if (isFirstDivergent) {
        cls.push('first')
      }
      if (expanded) {
        cls.push('expanded')
      }
      return cls.join(' ')
    }

    return html`
      <div class="step-row">
        <div
          class="${cellClass(left)}"
          data-first-divergent="${isFirstDivergent ? 'true' : 'false'}"
          @click="${() => this.#toggleExpand(pair.index)}"
        >
          ${left
            ? html`${pair.index + 1}. <code>${left.command}</code>${marker(
                  left,
                  this.swapped ? 'latest' : 'baseline'
                )}`
            : html`—`}
        </div>
        <div
          class="${cellClass(right)}"
          @click="${() => this.#toggleExpand(pair.index)}"
        >
          ${right
            ? html`${pair.index + 1}. <code>${right.command}</code>${marker(
                  right,
                  this.swapped ? 'baseline' : 'latest'
                )}`
            : html`—`}
        </div>
        ${expanded
          ? html`
              <div class="detail-panel">
                <div class="detail-grid">
                  ${this.#renderDetailBlock(
                    this.swapped ? 'Latest' : 'Baseline',
                    left
                  )}
                  ${this.#renderDetailBlock(
                    this.swapped ? 'Baseline' : 'Latest',
                    right
                  )}
                </div>
              </div>
            `
          : nothing}
      </div>
    `
  }

  #renderDetailBlock(label: string, cmd: CommandLog | undefined) {
    if (!cmd) {
      return html`<div class="detail-block">
        <h4>${label}</h4>
        <em style="opacity:0.6;">No command at this step</em>
      </div>`
    }
    const argsStr = safeJson(cmd.args)
    const resultStr = safeJson(cmd.result)
    return html`
      <div class="detail-block">
        <h4>${label} · ${cmd.command}</h4>
        <pre>args: ${argsStr}</pre>
        ${cmd.error
          ? html`<pre style="color:var(--vscode-charts-red,#f48771);">error: ${cmd.error.message || String(cmd.error)}</pre>`
          : html`<pre>result: ${resultStr}</pre>`}
        ${cmd.screenshot
          ? html`<img
              src="${cmd.screenshot.startsWith('data:')
                ? cmd.screenshot
                : `data:image/png;base64,${cmd.screenshot}`}"
              style="max-width:100%; margin-top:0.25rem; border:1px solid var(--vscode-panel-border,#2a2a2a);"
            />`
          : nothing}
      </div>
    `
  }

  #toggleExpand(index: number) {
    this.expandedIndex = this.expandedIndex === index ? null : index
  }
}

function safeJson(v: unknown): string {
  try {
    const s = JSON.stringify(v)
    if (!s) {
      return String(v)
    }
    return s.length > 500 ? s.slice(0, 500) + '…' : s
  } catch {
    return String(v)
  }
}

declare global {
  interface HTMLElementTagNameMap {
    [COMPONENT]: DevtoolsCompare
  }
}
