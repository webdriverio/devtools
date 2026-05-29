import { Element } from '@core/element'
import { html, css, nothing } from 'lit'
import { customElement, state } from 'lit/decorators.js'
import { consume } from '@lit/context'

import '~icons/mdi/open-in-new.js'

import type {
  CommandLog,
  PreservedAttempt,
  PreservedStep
} from '@wdio/devtools-shared'
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
  cleanErrorMessage,
  extractExpectedFromStepText,
  safeJson,
  type ComparePairedStep,
  type DivergenceKind
} from './compare/compareUtils.js'
import { BASELINE_API } from '@wdio/devtools-shared'
import { POPOUT_QUERY, buildPopoutFeatures } from './compare/constants.js'

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
        /* Needed so popout mode (where Compare sits directly under body) is themed. */
        background-color: var(--vscode-editor-background, #1e1e1e);
        color: var(--vscode-foreground, #cccccc);
      }
      .compare-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 0;
        flex: 1 1 auto;
        min-height: 0;
        overflow: auto;
        /* Stack rows from the top so they don't stretch to fill the grid. */
        align-content: start;
        grid-auto-rows: min-content;
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
      .marker.info {
        color: var(--vscode-descriptionForeground, #999);
        opacity: 0.7;
      }
      .error-banner {
        margin: 0.5rem 0.75rem;
        padding: 0.5rem 0.75rem;
        background: rgba(244, 135, 113, 0.12);
        border-left: 3px solid var(--vscode-charts-red, #f48771);
        border-radius: 3px;
        font-size: 0.85em;
      }
      .error-banner-title {
        font-weight: 600;
        margin-bottom: 0.25rem;
        opacity: 0.85;
        font-family: inherit;
      }
      /* Pre-wrap only on the message body so template indentation doesn't render. */
      .error-banner-message {
        font-family: var(--vscode-editor-font-family, monospace);
        white-space: pre-wrap;
        word-break: break-word;
        margin: 0;
      }
      .step-cell.missing {
        opacity: 0.35;
        font-style: italic;
      }
      .step-cell:hover {
        background: var(
          --vscode-toolbar-hoverBackground,
          rgba(255, 255, 255, 0.06)
        );
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
        background: var(
          --vscode-toolbar-hoverBackground,
          rgba(255, 255, 255, 0.06)
        );
      }
      button.action.icon-only {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: 0.25rem 0.4rem;
      }
      button.action.icon-only svg {
        width: 1em;
        height: 1em;
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

  // Hide the Pop out button when we're already in a popout.
  #isPopout =
    new URLSearchParams(window.location.search).get(POPOUT_QUERY.viewKey) ===
    POPOUT_QUERY.viewValue

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

  /** Walk live suiteContext under selectedTestUid and collect leaf tests
   *  so live commands can be attributed to their parent step. */
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
      if (!s) {
        return undefined
      }
      if (s.uid === target) {
        return s
      }
      for (const child of s.suites ?? []) {
        const hit = findRoot(child)
        if (hit) {
          return hit
        }
      }
      return undefined
    }
    for (const chunk of this.liveSuites) {
      for (const root of Object.values(chunk)) {
        foundRoot = findRoot(root)
        if (foundRoot) {
          break
        }
      }
      if (foundRoot) {
        break
      }
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
            t.state === 'pending' || t.state === 'running' ? t.state : t.state,
          error: t.error
            ? {
                message: t.error.message,
                name: t.error.name,
                stack: t.error.stack
              }
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
    if (!cmd?.timestamp) {
      return undefined
    }
    const steps =
      side === 'baseline'
        ? (this.#getBaseline()?.steps ?? [])
        : this.#liveStepsForSelectedUid()
    const ts = cmd.timestamp
    return steps.find(
      (s) =>
        s.start !== null &&
        s.start !== undefined &&
        s.end !== null &&
        s.end !== undefined &&
        ts >= s.start &&
        ts <= s.end
    )
  }

  /** The failure site is either the command that errored at the WebDriver
   *  level OR the last command in a failed step (assertion site). */
  #isFailureSite(
    cmd: CommandLog,
    step: PreservedStep | undefined,
    allCommandsOnSide: CommandLog[]
  ): boolean {
    if (!step || step.state !== 'failed') {
      return false
    }
    if (cmd.error?.message) {
      return true
    }
    if (step.start === null || step.end === null) {
      return false
    }
    let lastTs = 0
    for (const c of allCommandsOnSide) {
      if (
        c.timestamp !== null &&
        step.start !== undefined &&
        step.end !== undefined &&
        c.timestamp >= step.start &&
        c.timestamp <= step.end &&
        c.timestamp > lastTs
      ) {
        lastTs = c.timestamp
      }
    }
    return cmd.timestamp === lastTs
  }

  /** Scope the global live command stream to commands within the selected
   *  test's step time windows (mirrors the backend's snapshot filter). */
  #liveCommandsForSelectedUid(): CommandLog[] {
    const all = this.liveCommands || []
    const steps = this.#liveStepsForSelectedUid()
    if (steps.length === 0) {
      return all
    }
    let start = Number.POSITIVE_INFINITY
    let end = 0
    for (const s of steps) {
      if (s.start !== null && s.start !== undefined && s.start < start) {
        start = s.start
      }
      const candidateEnd = s.end ?? Date.now()
      if (candidateEnd > end) {
        end = candidateEnd
      }
    }
    if (!Number.isFinite(start)) {
      return all
    }
    return all.filter(
      (c) => c.timestamp !== null && c.timestamp >= start && c.timestamp <= end
    )
  }

  async #clearBaseline() {
    if (!this.selectedTestUid) {
      return
    }
    try {
      await fetch(BASELINE_API.clear, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ testUid: this.selectedTestUid })
      })
    } catch {
      // best-effort; the server broadcast updates the context.
    }
  }

  #popOut() {
    if (!this.selectedTestUid) {
      return
    }
    const params = new URLSearchParams({
      [POPOUT_QUERY.viewKey]: POPOUT_QUERY.viewValue,
      [POPOUT_QUERY.uidKey]: this.selectedTestUid
    })
    const url = `${window.location.pathname}?${params.toString()}`
    window.open(url, `compare-${this.selectedTestUid}`, buildPopoutFeatures())
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
    const latestCommands = this.#liveCommandsForSelectedUid()

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
      ? cleanErrorMessage(baseline.test.error.message)
      : undefined
    return html`
      <div class="topbar">
        <span class="pill ${baseline.test.state || ''}">
          Baseline · ${baseline.test.state || 'unknown'} ·
          ${baselineCommands.length} commands
        </span>
        <span>⇄</span>
        <span class="pill"> Latest · ${latestCommands.length} commands </span>
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
        ${this.#isPopout
          ? nothing
          : html`
              <button
                class="action icon-only"
                @click="${() => this.#popOut()}"
                title="Open this comparison in a separate window"
                aria-label="Open in a separate window"
              >
                <icon-mdi-open-in-new></icon-mdi-open-in-new>
              </button>
            `}
      </div>
      ${errorMessage
        ? html`<div class="error-banner">
            <div class="error-banner-title">Why the baseline failed</div>
            <div class="error-banner-message">${errorMessage}</div>
          </div>`
        : nothing}
      <div class="compare-grid">
        <div class="col-header">${this.swapped ? 'Latest' : 'Baseline'}</div>
        <div class="col-header">${this.swapped ? 'Baseline' : 'Latest'}</div>
        ${visiblePairs.map((pair) =>
          this.#renderPair(pair, leftCommands, rightCommands, firstDivergent)
        )}
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
    const kind: DivergenceKind = classifyDivergence(left, right)
    const stepFor = (
      cmd: CommandLog | undefined,
      side: 'baseline' | 'latest'
    ) => this.#findStepFor(cmd, side)
    // Skip "missing" markers when one side is entirely empty (e.g. the rerun
    // hasn't produced commands yet). The populated side should display its
    // own status, not be falsely flagged as "missing".
    const leftEmpty = leftCommands.length === 0
    const rightEmpty = rightCommands.length === 0
    const oneSideEntirelyEmpty = leftEmpty || rightEmpty
    const marker = (
      cmd: CommandLog | undefined,
      side: 'baseline' | 'latest'
    ) => {
      if (!cmd) {
        return nothing
      }
      // Row-level divergence wins over the per-command status marker.
      switch (kind) {
        case 'commandName':
          return html`<span
            class="marker command"
            title="Different WebDriver command — execution diverged at this step"
            >different command</span
          >`
        case 'args':
          return html`<span
            class="marker command"
            title="Same command, different arguments (compare args in the expanded view)"
            >args differ</span
          >`
        case 'error':
          if (cmd.error?.message) {
            return html`<span
              class="marker error"
              title="WebDriver error: ${cmd.error.message}"
              >⚠ error</span
            >`
          }
          break
      }
      const step = stepFor(cmd, side)
      const allCmdsThisSide =
        side === 'baseline'
          ? ((this.#getBaseline()?.commands ?? []) as CommandLog[])
          : this.#liveCommandsForSelectedUid()
      const statusMarker =
        step?.state === 'failed' &&
        this.#isFailureSite(cmd, step, allCmdsThisSide)
          ? html`<span
              class="marker error"
              title="${step.error?.message
                ? `Failed step: ${step.fullTitle || step.title || step.uid}\n${step.error.message}`
                : `Failed step: ${step.fullTitle || step.title || step.uid}`}"
              >✗ in failed step</span
            >`
          : step?.state === 'passed'
            ? html`<span
                class="marker ok"
                title="Step passed: ${step.fullTitle || step.title || step.uid}"
                >✓</span
              >`
            : html`<span class="marker ok" title="Identical">✓</span>`
      // Truncation: status + a muted "only here" pill.
      if (kind === 'missing' && !oneSideEntirelyEmpty) {
        return html`${statusMarker}<span
            class="marker info"
            title="Only present on this side — the other run ended before this step"
            >only here</span
          >`
      }
      return statusMarker
    }

    // Truncation = one side has the command, the other doesn't.
    const isTruncation = !left || !right
    /** Per-cell divergence so the passing side stays neutral when only the
     *  other side has the actual problem. */
    const cellIsDivergent = (
      cmd: CommandLog | undefined,
      side: 'baseline' | 'latest'
    ) => {
      if (!pair.divergent || isTruncation || !cmd) {
        return false
      }
      switch (kind) {
        case 'commandName':
        case 'args':
          // Both sides genuinely differ — both cells are divergent.
          return true
        case 'error':
          // Only the side with the actual error is divergent.
          return !!cmd.error?.message
        case 'missing':
          return false
        case 'none':
        default: {
          // Step-level failure site: only the failure site is divergent.
          const step = this.#findStepFor(cmd, side)
          if (step?.state !== 'failed') {
            return false
          }
          const allCmds =
            side === 'baseline'
              ? ((this.#getBaseline()?.commands ?? []) as CommandLog[])
              : this.#liveCommandsForSelectedUid()
          return this.#isFailureSite(cmd, step, allCmds)
        }
      }
    }
    const cellClass = (
      cmd: CommandLog | undefined,
      side: 'baseline' | 'latest'
    ) => {
      const cls = ['step-cell']
      if (!cmd) {
        cls.push('missing')
      }
      const divergent = cellIsDivergent(cmd, side)
      if (divergent) {
        cls.push('divergent')
      }
      if (isFirstDivergent && divergent) {
        cls.push('first')
      }
      if (expanded) {
        cls.push('expanded')
      }
      return cls.join(' ')
    }

    type Side = 'baseline' | 'latest'
    const leftSide: Side = this.swapped ? 'latest' : 'baseline'
    const rightSide: Side = this.swapped ? 'baseline' : 'latest'
    return html`
      <div class="step-row">
        <div
          class="${cellClass(left, leftSide)}"
          data-first-divergent="${isFirstDivergent ? 'true' : 'false'}"
          @click="${() => this.#toggleExpand(pair.index)}"
        >
          ${left
            ? html`${pair.index + 1}. <code>${left.command}</code>${marker(
                  left,
                  leftSide
                )}`
            : html`—`}
        </div>
        <div
          class="${cellClass(right, rightSide)}"
          @click="${() => this.#toggleExpand(pair.index)}"
        >
          ${right
            ? html`${pair.index + 1}. <code>${right.command}</code>${marker(
                  right,
                  rightSide
                )}`
            : html`—`}
        </div>
        ${expanded
          ? html`
              <div class="detail-panel">
                <div class="detail-grid">
                  ${this.#renderDetailBlock(
                    this.swapped ? 'Latest' : 'Baseline',
                    left,
                    this.swapped ? 'latest' : 'baseline'
                  )}
                  ${this.#renderDetailBlock(
                    this.swapped ? 'Baseline' : 'Latest',
                    right,
                    this.swapped ? 'baseline' : 'latest'
                  )}
                </div>
              </div>
            `
          : nothing}
      </div>
    `
  }

  #renderDetailBlock(
    label: string,
    cmd: CommandLog | undefined,
    side: 'baseline' | 'latest'
  ) {
    if (!cmd) {
      return html`<div class="detail-block">
        <h4>${label}</h4>
        <em style="opacity:0.6;">No command at this step</em>
      </div>`
    }
    const argsStr = safeJson(cmd.args)
    const resultStr = safeJson(cmd.result)
    const step = this.#findStepFor(cmd, side)
    // Only the failure-site command shows step-level expected/actual/assertion;
    // other commands in the failed step succeeded individually.
    const allCmdsThisSide =
      side === 'baseline'
        ? ((this.#getBaseline()?.commands ?? []) as CommandLog[])
        : this.#liveCommandsForSelectedUid()
    const isFailureSite = this.#isFailureSite(cmd, step, allCmdsThisSide)
    const expected =
      isFailureSite && step?.error?.expected !== undefined
        ? step.error.expected
        : isFailureSite
          ? step?.error?.matcherResult?.expected
          : undefined
    const actual =
      isFailureSite && step?.error?.actual !== undefined
        ? step.error.actual
        : isFailureSite
          ? step?.error?.matcherResult?.actual
          : undefined
    const rawAssertion = isFailureSite
      ? step?.error?.matcherResult?.message || step?.error?.message
      : undefined
    const assertionMessage = rawAssertion
      ? cleanErrorMessage(rawAssertion)
      : undefined
    // Fallback: extract the expected from the Cucumber step text.
    const stepText = step?.fullTitle || step?.title || ''
    const fallbackExpected =
      isFailureSite && expected === undefined && step?.state === 'failed'
        ? extractExpectedFromStepText(stepText)
        : undefined
    return html`
      <div class="detail-block">
        <h4>${label} · ${cmd.command}</h4>
        ${step
          ? html`<pre
              style="opacity:0.85; border-left:2px solid ${step.state ===
              'failed'
                ? 'var(--vscode-charts-red,#f48771)'
                : 'var(--vscode-charts-green,#73c373)'}; padding-left:0.5rem;"
            >
step: ${stepText || step.uid}</pre
            >`
          : nothing}
        <pre>args: ${argsStr}</pre>
        ${cmd.error
          ? html`<pre style="color:var(--vscode-charts-red,#f48771);">
error: ${cmd.error.message || String(cmd.error)}</pre
            >`
          : html`<pre>result: ${resultStr}</pre>`}
        ${expected !== undefined
          ? html`<pre
              style="color:var(--vscode-charts-green,#73c373); white-space:pre-wrap; word-break:break-word;"
            >
expected: ${safeJson(expected)}</pre
            >`
          : fallbackExpected
            ? html`<pre
                style="color:var(--vscode-charts-green,#73c373); white-space:pre-wrap; word-break:break-word;"
                title="Derived from the step text (the assertion library didn't surface a structured expected value)"
              >
expected (from step): ${fallbackExpected}</pre
              >`
            : nothing}
        ${actual !== undefined
          ? html`<pre
              style="color:var(--vscode-charts-orange,#d19a66); white-space:pre-wrap; word-break:break-word;"
            >
actual:   ${safeJson(actual)}</pre
            >`
          : nothing}
        ${assertionMessage
          ? html`<pre
              style="color:var(--vscode-charts-red,#f48771); white-space:pre-wrap; word-break:break-word; max-height:200px; overflow:auto;"
            >
assertion: ${assertionMessage}</pre
            >`
          : nothing}
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

declare global {
  interface HTMLElementTagNameMap {
    [COMPONENT]: DevtoolsCompare
  }
}
