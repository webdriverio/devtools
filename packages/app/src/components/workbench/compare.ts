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
  type ComparePairedStep,
  type DivergenceKind
} from './compare/compareUtils.js'

interface RenderPairCtx {
  pair: ComparePairedStep
  kind: DivergenceKind
  isTruncation: boolean
  oneSideEntirelyEmpty: boolean
  expanded: boolean
  isFirstDivergent: boolean
}
import { BASELINE_API, type BaselineClearRequest } from '@wdio/devtools-shared'
import { POPOUT_QUERY, buildPopoutFeatures } from './compare/constants.js'
import { renderMarker } from './compare/markers.js'
import { compareStyles } from './compare/styles.js'
import {
  liveStepsForUid,
  findStepFor,
  isFailureSite
} from './compare/stepResolution.js'
import { renderDetailBlock } from './compare/renderDetailBlock.js'

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

  #renderEmptyState() {
    return html`
      <div class="empty-state">
        <div>
          <p>No baseline preserved.</p>
          <p>
            Click the
            <strong>📌 Preserve &amp; Rerun</strong> button on a failed test to
            compare the failing run against the rerun.
          </p>
        </div>
      </div>
    `
  }

  #renderPopoutButton() {
    if (this.#isPopout) {
      return nothing
    }
    return html`
      <button
        class="action icon-only"
        @click="${() => this.#popOut()}"
        title="Open this comparison in a separate window"
        aria-label="Open in a separate window"
      >
        <icon-mdi-open-in-new></icon-mdi-open-in-new>
      </button>
    `
  }

  #renderTopbar(baseline: PreservedAttempt, latestCount: number) {
    const baselineCount = (baseline.commands as CommandLog[]).length
    return html`
      <div class="topbar">
        <span class="pill ${baseline.test.state || ''}">
          <i class="dot"></i>
          Baseline · ${baseline.test.state || 'unknown'} · ${baselineCount}
          commands
        </span>
        <span class="swap-ico">⇄</span>
        <span class="pill">
          <i class="dot"></i> Latest · ${latestCount} commands
        </span>
        <span class="scope">
          ${baseline.scope === 'suite' ? 'suite scope' : 'test scope'}
        </span>
        <div class="actions-group">
          <label class="toggle-label">
            <input
              type="checkbox"
              .checked=${this.differencesOnly}
              @change="${(e: Event) =>
                (this.differencesOnly = (
                  e.target as HTMLInputElement
                ).checked)}"
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
          ${this.#renderPopoutButton()}
        </div>
      </div>
    `
  }

  render() {
    const baseline = this.#getBaseline()
    if (!baseline) {
      return this.#renderEmptyState()
    }
    const baselineCommands = baseline.commands as CommandLog[]
    const latestCommands = this.#liveCommandsForSelectedUid()
    // Naming follows physical sides (left/right) after swap.
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
      ${this.#renderTopbar(baseline, latestCommands.length)}
      ${errorMessage
        ? html`<div class="error-banner">
            <div class="error-banner-title">Why the baseline failed</div>
            <div class="error-banner-message">${errorMessage}</div>
          </div>`
        : nothing}
      <div class="cmp-colhead">
        <div class="col-header">${this.swapped ? 'Latest' : 'Baseline'}</div>
        <div class="col-header">${this.swapped ? 'Baseline' : 'Latest'}</div>
      </div>
      <div class="cmp-body">
        <div class="cmp-rows">
          ${visiblePairs.map((pair) =>
            this.#renderPair(pair, leftCommands, rightCommands, firstDivergent)
          )}
        </div>
      </div>
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
    const ctx: RenderPairCtx = {
      pair,
      kind,
      isTruncation: !left || !right,
      oneSideEntirelyEmpty,
      expanded,
      isFirstDivergent
    }
    type Side = 'baseline' | 'latest'
    const leftSide: Side = this.swapped ? 'latest' : 'baseline'
    const rightSide: Side = this.swapped ? 'baseline' : 'latest'
    return html`
      <div class="step-row">
        ${this.#renderPairCell(left, leftSide, ctx)}
        ${this.#renderPairCell(right, rightSide, ctx)}
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

  #cellIsDivergent(
    cmd: CommandLog | undefined,
    side: 'baseline' | 'latest',
    ctx: RenderPairCtx
  ): boolean {
    if (!ctx.pair.divergent || ctx.isTruncation || !cmd) {
      return false
    }
    switch (ctx.kind) {
      case 'commandName':
      case 'args':
        return true
      case 'error':
        return !!cmd.error?.message
      case 'missing':
        return false
      case 'none':
      default: {
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

  #renderPairCell(
    cmd: CommandLog | undefined,
    side: 'baseline' | 'latest',
    ctx: RenderPairCtx
  ) {
    const cls = ['step-cell']
    if (!cmd) {
      cls.push('missing')
    }
    const divergent = this.#cellIsDivergent(cmd, side, ctx)
    if (divergent) {
      cls.push('divergent')
    }
    if (ctx.isFirstDivergent && divergent) {
      cls.push('first')
    }
    if (ctx.expanded) {
      cls.push('expanded')
    }
    const allCmds =
      side === 'baseline'
        ? ((this.#getBaseline()?.commands ?? []) as CommandLog[])
        : this.#liveCommandsForSelectedUid()
    const marker = renderMarker({
      cmd,
      kind: ctx.kind,
      step: this.#findStepFor(cmd, side),
      allCmdsThisSide: allCmds,
      oneSideEntirelyEmpty: ctx.oneSideEntirelyEmpty
    })
    return html`
      <div
        class="${cls.join(' ')}"
        data-first-divergent="${ctx.isFirstDivergent ? 'true' : 'false'}"
        @click="${() => this.#toggleExpand(ctx.pair.index)}"
      >
        ${cmd
          ? html`${ctx.pair.index + 1}. <code>${cmd.command}</code>${marker}`
          : html`—`}
      </div>
    `
  }

  #renderDetailBlock(
    label: string,
    cmd: CommandLog | undefined,
    side: 'baseline' | 'latest'
  ) {
    return renderDetailBlock(label, cmd, side, {
      baseline: this.#getBaseline(),
      liveCommandsForSelectedUid: () => this.#liveCommandsForSelectedUid(),
      findStepFor: (c, s) => this.#findStepFor(c, s)
    })
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
