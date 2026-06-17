import { html, nothing, type TemplateResult } from 'lit'
import type { CommandLog, PreservedStep } from '@wdio/devtools-shared'
import { type DivergenceKind } from './compareUtils.js'
import { isFailureSite } from './stepResolution.js'

export interface MarkerContext {
  cmd: CommandLog | undefined
  /** Pre-classified divergence kind for the row (shared across left/right cells). */
  kind: DivergenceKind
  /** Already-resolved step for this command + side (resolved by the parent). */
  step: PreservedStep | undefined
  /**
   * All commands on this side, used by `isFailureSite` to decide whether this
   * specific command is the failure-site (vs another command in the same
   * failed step). The parent computes it once per side and passes it in to
   * avoid redundant resolver calls.
   */
  allCmdsThisSide: CommandLog[]
  /**
   * True when one of the two compared runs has zero commands. Suppresses the
   * "only here" pill on truncated rows — the populated side should display
   * its own status, not be falsely flagged.
   */
  oneSideEntirelyEmpty: boolean
}

/**
 * Render the per-cell status marker for the Compare view. Extracted from
 * `<wdio-devtools-compare>#renderPair` — pure function of `MarkerContext`,
 * no component-state coupling. Returns a Lit template, an `html` fragment
 * (for the truncation "only here" case), or `nothing` when there's no
 * command to mark.
 */
function renderRowDivergenceMarker(
  kind: MarkerContext['kind'],
  cmd: NonNullable<MarkerContext['cmd']>
): TemplateResult | undefined {
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
      return undefined
  }
  return undefined
}

function renderStatusMarker(
  cmd: NonNullable<MarkerContext['cmd']>,
  step: MarkerContext['step'],
  allCmdsThisSide: MarkerContext['allCmdsThisSide']
): TemplateResult {
  if (step?.state === 'failed' && isFailureSite(cmd, step, allCmdsThisSide)) {
    const id = step.fullTitle || step.title || step.uid
    const titleText = step.error?.message
      ? `Failed step: ${id}\n${step.error.message}`
      : `Failed step: ${id}`
    return html`<span class="marker error" title="${titleText}"
      >✗ in failed step</span
    >`
  }
  if (step?.state === 'passed') {
    return html`<span
      class="marker ok"
      title="Step passed: ${step.fullTitle || step.title || step.uid}"
      >✓</span
    >`
  }
  return html`<span class="marker ok" title="Identical">✓</span>`
}

export function renderMarker(
  opts: MarkerContext
): TemplateResult | typeof nothing {
  const { cmd, kind, step, allCmdsThisSide, oneSideEntirelyEmpty } = opts
  if (!cmd) {
    return nothing
  }
  const divergence = renderRowDivergenceMarker(kind, cmd)
  if (divergence) {
    return divergence
  }
  const statusMarker = renderStatusMarker(cmd, step, allCmdsThisSide)
  if (kind === 'missing' && !oneSideEntirelyEmpty) {
    // `only here` before the status so the ✓ stays in the right-edge column,
    // aligned with rows that show only a ✓.
    return html`<span
        class="marker info"
        title="Only present on this side — the other run ended before this step"
        >only here</span
      >${statusMarker}`
  }
  return statusMarker
}
