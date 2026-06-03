/**
 * Detail-block rendering for the compare view. Extracted from the host
 * component so the Lit class stays under the file-size cap; everything
 * the renderers need is passed in through the {@link DetailBlockCtx} bag.
 */

import { html, nothing, type TemplateResult } from 'lit'
import type {
  CommandLog,
  PreservedAttempt,
  PreservedStep
} from '@wdio/devtools-shared'
import { safeJson } from './compareUtils.js'
import { computeDetailBlockData } from './stepResolution.js'

/** Hooks the detail-block renderers need to reach component state. */
export interface DetailBlockCtx {
  baseline: PreservedAttempt | undefined
  liveCommandsForSelectedUid(): CommandLog[]
  findStepFor(
    cmd: CommandLog | undefined,
    side: 'baseline' | 'latest'
  ): PreservedStep | undefined
}

export function renderDetailStepBanner(
  step: PreservedStep | undefined,
  stepText: string
): TemplateResult | typeof nothing {
  if (!step) {
    return nothing
  }
  const color =
    step.state === 'failed'
      ? 'var(--vscode-charts-red,#f48771)'
      : 'var(--vscode-charts-green,#73c373)'
  return html`<pre
    style="opacity:0.85; border-left:2px solid ${color}; padding-left:0.5rem;"
  >
step: ${stepText || step.uid}</pre
  >`
}

export function renderExpectedActualAssertion(
  expected: unknown,
  actual: unknown,
  assertionMessage: string | undefined,
  fallbackExpected: string | undefined
): TemplateResult {
  return html`
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
  `
}

export function renderDetailBlock(
  label: string,
  cmd: CommandLog | undefined,
  side: 'baseline' | 'latest',
  ctx: DetailBlockCtx
): TemplateResult {
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
      ? ((ctx.baseline?.commands ?? []) as CommandLog[])
      : ctx.liveCommandsForSelectedUid()
  const data = computeDetailBlockData(
    cmd,
    ctx.findStepFor(cmd, side),
    allCmdsThisSide
  )
  return html`
    <div class="detail-block">
      <h4>${label} · ${cmd.command}</h4>
      ${renderDetailStepBanner(data.step, data.stepText)}
      <pre>args: ${data.argsStr}</pre>
      ${cmd.error
        ? html`<pre style="color:var(--vscode-charts-red,#f48771);">
error: ${cmd.error.message || String(cmd.error)}</pre
          >`
        : html`<pre>result: ${data.resultStr}</pre>`}
      ${renderExpectedActualAssertion(
        data.expected,
        data.actual,
        data.assertionMessage,
        data.fallbackExpected
      )}
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
