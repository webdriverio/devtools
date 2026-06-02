import { Element } from '@core/element'
import { html, nothing } from 'lit'
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
  safeJson,
  type ComparePairedStep,
  type DivergenceKind
} from './compare/compareUtils.js'
import { BASELINE_API, type BaselineClearRequest } from '@wdio/devtools-shared'
import { POPOUT_QUERY, buildPopoutFeatures } from './compare/constants.js'
import { renderMarker } from './compare/markers.js'
import { compareStyles } from './compare/styles.js'
import {
  liveStepsForUid,
  findStepFor,
  isFailureSite,
  computeDetailBlockData
} from './compare/stepResolution.js'

const COMPONENT = 'wdio-devtools-compare'

@customElement(COMPONENT)
export class DevtoolsCompare extends Element {
  static styles = [...Element.styles, compareStyles]

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
    return liveStepsForUid(this.selectedTestUid, this.liveSuites)
  }

  #findStepFor(
    cmd: CommandLog | undefined,
    side: 'baseline' | 'latest'
  ): PreservedStep | undefined {
    return findStepFor(
      cmd,
      side,
      this.#getBaseline(),
      this.#liveStepsForSelectedUid()
    )
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
      const body: BaselineClearRequest = { testUid: this.selectedTestUid }
      await fetch(BASELINE_API.clear, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
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
    // Skip "missing" markers when one side is entirely empty (e.g. the rerun
    // hasn't produced commands yet). The populated side should display its
    // own status, not be falsely flagged as "missing".
    const oneSideEntirelyEmpty =
      leftCommands.length === 0 || rightCommands.length === 0
    const baselineCmds = (this.#getBaseline()?.commands ?? []) as CommandLog[]
    const latestCmds = this.#liveCommandsForSelectedUid()
    const marker = (cmd: CommandLog | undefined, side: 'baseline' | 'latest') =>
      renderMarker({
        cmd,
        kind,
        step: this.#findStepFor(cmd, side),
        allCmdsThisSide: side === 'baseline' ? baselineCmds : latestCmds,
        oneSideEntirelyEmpty
      })

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
          return isFailureSite(cmd, step, allCmds)
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
    // Only the failure-site command shows step-level expected/actual/assertion;
    // other commands in the failed step succeeded individually.
    const allCmdsThisSide =
      side === 'baseline'
        ? ((this.#getBaseline()?.commands ?? []) as CommandLog[])
        : this.#liveCommandsForSelectedUid()
    const {
      argsStr,
      resultStr,
      step,
      expected,
      actual,
      assertionMessage,
      fallbackExpected,
      stepText
    } = computeDetailBlockData(
      cmd,
      this.#findStepFor(cmd, side),
      allCmdsThisSide
    )
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
