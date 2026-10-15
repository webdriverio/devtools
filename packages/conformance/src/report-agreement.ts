import { gapsFor } from './allowlist.js'
import { compareRuns, judgeDivergences } from './agreement.js'
import { BIDI_MODES } from './constants.js'
import { describeRunControls, normalizeRun } from './normalize.js'
import type {
  BidiMode,
  Divergence,
  KnownGap,
  NormalizedStep,
  RunReport
} from './types.js'

type Escape = (text: string) => string

/** One table per mode: a column per adapter, a row per step, differing rows highlighted. */
export function renderAgreement(runs: RunReport[], escape: Escape): string {
  const sections = BIDI_MODES.map((bidi) =>
    runs.filter((r) => r.bidi === bidi && !r.checkerError)
  )
    .filter((group) => group.length > 1)
    .map((group) => renderMode(group, escape))
  return sections.length
    ? `<h2>Do the adapters agree?</h2>\n${sections.join('\n')}`
    : ''
}

function renderMode(runs: RunReport[], escape: Escape): string {
  const sorted = [...runs].sort((a, b) => a.adapter.localeCompare(b.adapter))
  const bidi = sorted[0].bidi
  const normalized = sorted.map((r) => normalizeRun(r.frames))
  const { unexplained, explained, stale } = judgeDivergences(
    compareRuns(sorted),
    sorted
  )
  const agree = !unexplained.length && !explained.length && !stale.length
  const length = Math.max(...normalized.map((n) => n.steps.length))
  const stepRows = Array.from({ length }, (_, i) =>
    renderRow(
      `${i + 1}`,
      normalized.map((n) => describeStep(n.steps[i])),
      escape
    )
  )
  const footRows = [
    renderRow(
      'snapshots',
      normalized.map((n) => n.snapshots.join(', ') || '(none)'),
      escape
    ),
    renderRow(
      'run controls',
      normalized.map((n) => describeRunControls(n.runControls)),
      escape
    ),
    renderRow(
      'requests',
      normalized.map((n) => n.requests.join(', ') || '(none)'),
      escape
    )
  ]
  return `<details class="run"${agree ? '' : ' open'}>
<summary><strong>bidi ${bidi}</strong>
${verdictBadge(unexplained.length, explained.length, stale.length)}
<span class="counts">${unexplained.length} unexplained, ${explained.length} allowlisted differences, ${stale.length} stale gaps</span></summary>
<div class="body">
${renderDivergences(unexplained, explained, bidi, escape)}
${stale.map((gap) => renderStale(gap, escape)).join('\n')}
<table>
<thead><tr><th>step</th>${sorted.map((r) => `<th>${escape(r.adapter)}</th>`).join('')}</tr></thead>
<tbody>
${[...stepRows, ...footRows].join('\n')}
</tbody>
</table>
</div>
</details>`
}

function describeStep(step: NormalizedStep | undefined): string {
  return step
    ? `${step.action} ${step.target}${step.input === undefined ? '' : ` ${JSON.stringify(step.input)}`} → ${step.outcome}, shows ${step.page}`
    : '(no step)'
}

function renderRow(label: string, cells: string[], escape: Escape): string {
  const differs = new Set(cells).size > 1
  return `<tr${differs ? ' class="differs"' : ''}><td class="t">${escape(label)}</td>${cells
    .map((c) => `<td><code>${escape(c)}</code></td>`)
    .join('')}</tr>`
}

function renderDivergences(
  unexplained: Divergence[],
  explained: Divergence[],
  bidi: BidiMode,
  escape: Escape
): string {
  const reasonFor = (d: Divergence) =>
    d.adapters
      .flatMap((id) => gapsFor(id, bidi))
      .find((g) => g.rules.includes(d.rule))?.reason ?? ''
  const items = [
    ...unexplained.map(
      (d) =>
        `<li class="unexplained"><strong>UNEXPLAINED</strong> <code>${escape(d.rule)}</code>: ${escape(d.message)}</li>`
    ),
    ...explained.map(
      (d) =>
        `<li class="allowed"><strong>allowlisted</strong> <code>${escape(d.rule)}</code>: ${escape(d.message)}<span class="reason">${escape(reasonFor(d))}</span></li>`
    )
  ]
  return items.length ? `<ul class="v">${items.join('')}</ul>` : ''
}

/** A declared gap that matched nothing; the per-run and the comparison sections both show it. */
export function renderStale(gap: KnownGap, escape: Escape): string {
  return `<p class="fail"><strong>Stale gap</strong> for <code>${escape(gap.adapter)}</code> (${escape(
    gap.rules.join(', ')
  )}): ${escape(gap.reason)}</p>`
}

function verdictBadge(
  unexplained: number,
  explained: number,
  stale: number
): string {
  if (unexplained) {
    return '<span class="badge fail">DIVERGE</span>'
  }
  // A stale gap fails the comparison, so the mode must not read as agreeing.
  if (stale) {
    return `<span class="badge fail">STALE GAPS (${stale})</span>`
  }
  return explained
    ? `<span class="badge known">KNOWN DIFFERENCES (${explained})</span>`
    : '<span class="badge pass">AGREE</span>'
}
