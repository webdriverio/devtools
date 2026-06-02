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
export function renderMarker(
  opts: MarkerContext
): TemplateResult | typeof nothing {
  const { cmd, kind, step, allCmdsThisSide, oneSideEntirelyEmpty } = opts
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

  const statusMarker =
    step?.state === 'failed' && isFailureSite(cmd, step, allCmdsThisSide)
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
