import { explainingGap, gapsFor } from './allowlist.js'
import { BIDI_MODES, RESPONSIBILITIES } from './constants.js'
import { renderAgreement } from './report-agreement.js'
import { RULE_GUIDE } from './rule-guide.js'
import { buildTimeline } from './timeline.js'
import type {
  KnownGap,
  RunReport,
  Timeline,
  TimelineEvent,
  Violation
} from './types.js'

const STYLE = `
:root{color-scheme:light dark;--bg:#fff;--fg:#1d1f23;--muted:#5f6670;--line:#d9dde3;--panel:#f5f7f9;--pass:#17723a;--fail:#b3261e;--warn:#8a5a00;--doc:#3355aa;--anchor:#6a3fa0}
@media (prefers-color-scheme:dark){:root{--bg:#15171a;--fg:#e6e8eb;--muted:#9aa2ad;--line:#33373d;--panel:#1e2125;--pass:#5fcf86;--fail:#ff8a80;--warn:#e6b450;--doc:#8fa8ff;--anchor:#c39bff}}
*{box-sizing:border-box}
body{margin:0;padding:16px;background:var(--bg);color:var(--fg);font:14px/1.45 system-ui,sans-serif}
h1{font-size:20px;margin:0 0 16px}
h2{font-size:16px;margin:20px 0 10px}
tr.differs td{background:color-mix(in srgb,var(--fail) 14%,transparent)}
details.run{border:1px solid var(--line);border-radius:6px;margin:0 0 16px;background:var(--bg)}
details.run>summary{cursor:pointer;padding:10px 12px;background:var(--panel);border-radius:6px;display:flex;flex-wrap:wrap;gap:12px;align-items:baseline}
.badge{font-weight:700;padding:1px 8px;border-radius:4px;border:1px solid currentColor}
.pass{color:var(--pass)}.fail{color:var(--fail)}.known{color:var(--warn)}
.counts{color:var(--muted)}
.body{padding:12px;overflow-x:auto}
table{border-collapse:collapse;width:100%}
td,th{text-align:left;padding:3px 8px;border-bottom:1px solid var(--line);vertical-align:top}
th{color:var(--muted);font-weight:600}
td.t{font-variant-numeric:tabular-nums;white-space:nowrap;color:var(--muted)}
code{font:12px/1.4 ui-monospace,monospace;word-break:break-all}
.k-document{color:var(--doc)}.k-anchor{color:var(--anchor)}
.err{color:var(--fail);font-weight:700}
ul.v{margin:4px 0;padding-left:18px}
li.unexplained{color:var(--fail)}
li.allowed{color:var(--warn)}
.reason{display:block;color:var(--muted)}
.look{border:1px solid var(--fail);border-radius:6px;padding:8px 12px;margin:0 0 12px}
.look>ul>li{margin:6px 0}
a{color:var(--doc)}
pre{background:var(--panel);padding:8px;border-radius:4px;overflow-x:auto;font:12px/1.4 ui-monospace,monospace}
`

export function renderReport(runs: RunReport[]): string {
  const sorted = [...runs].sort(
    (a, b) =>
      a.adapter.localeCompare(b.adapter) ||
      BIDI_MODES.indexOf(a.bidi) - BIDI_MODES.indexOf(b.bidi)
  )
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Conformance report</title>
<style>${STYLE}</style>
</head>
<body>
<h1>Conformance report</h1>
${renderAgreement(sorted, escapeHtml)}
${sorted.length ? `<h2>Each adapter against the rules</h2>\n${sorted.map(renderRun).join('\n')}` : '<p>No runs recorded.</p>'}
</body>
</html>
`
}

export function runPassed(run: RunReport): boolean {
  return (
    run.exitCode === 0 &&
    !run.checkerError &&
    run.unexplained.length === 0 &&
    run.stale.length === 0
  )
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function renderRun(run: RunReport): string {
  const passed = runPassed(run)
  const timeline = safeTimeline(run)
  const unexplained = new Set(run.unexplained.map(violationKey))
  const gaps = gapsFor(run.adapter, run.bidi)
  const renderViolations = (violations: Violation[]) =>
    renderViolationList(violations, unexplained, gaps)
  const rows = timeline.events
    .map((e) => renderEvent(e, timeline.origin, renderViolations))
    .join('\n')
  return `<details class="run"${passed ? '' : ' open'}>
<summary><strong>${escapeHtml(run.adapter)}</strong>
<span>bidi ${escapeHtml(run.bidi)}</span>
<span class="badge ${passed ? 'pass">PASS' : 'fail">FAIL'}</span>
<span class="counts">exit ${escapeHtml(String(run.exitCode))}, ${timeline.events.length} events, ${run.violations.length} violations, ${run.unexplained.length} unexplained, ${run.stale.length} stale gaps</span></summary>
<div class="body">
${run.checkerError ? `<p class="fail"><strong>Checker failed</strong>: ${escapeHtml(run.checkerError)}</p>` : ''}
${renderWhereToLook(run)}
${timeline.unplaced.length ? `<p>Run-level violations:</p>${renderViolations(timeline.unplaced)}` : ''}
${run.stale.map(renderStale).join('\n')}
<table>
<thead><tr><th>time</th><th>event</th><th>detail</th></tr></thead>
<tbody>
${rows}
</tbody>
</table>
<details><summary>scenario output</summary><pre>${escapeHtml(run.output)}</pre></details>
</div>
</details>`
}

// A stream the checker could not read has no timeline; the header, the error and the output still show.
function safeTimeline(run: RunReport): Timeline {
  try {
    return buildTimeline(run)
  } catch {
    return { origin: 0, events: [], unplaced: run.violations }
  }
}

function renderEvent(
  event: TimelineEvent,
  origin: number,
  renderViolations: (violations: Violation[]) => string
): string {
  const rel = (ms: number) => `+${ms - origin} ms`
  const [label, detail] =
    event.kind === 'row'
      ? [
          `${escapeHtml(event.command)}${event.failed ? ' <span class="err">error</span>' : ''}`,
          `<code>${escapeHtml(event.target)}</code> ${escapeHtml(
            event.startTime === undefined
              ? `ends ${rel(event.timestamp)}`
              : `${rel(event.startTime)} .. ${rel(event.timestamp)}`
          )}`
        ]
      : [
          event.kind === 'document' ? 'document born' : 'DOM anchor',
          `<code>${escapeHtml(event.url)}</code>`
        ]
  return `<tr class="k-${event.kind}"><td class="t">${escapeHtml(rel(event.at))}</td><td>${label}</td><td>${detail}${
    event.violations.length ? renderViolations(event.violations) : ''
  }</td></tr>`
}

function renderViolationList(
  violations: Violation[],
  unexplained: Set<string>,
  gaps: KnownGap[]
): string {
  const items = violations.map((v) => {
    const isUnexplained = unexplained.has(violationKey(v))
    const reason = isUnexplained
      ? ''
      : `<span class="reason">allowlisted: ${escapeHtml(
          explainingGap(gaps, v)?.reason ?? 'no reason recorded'
        )}</span>`
    return `<li class="${isUnexplained ? 'unexplained' : 'allowed'}"><strong>${
      isUnexplained ? 'UNEXPLAINED' : 'allowlisted'
    }</strong> <code>${escapeHtml(v.rule)}</code>: ${escapeHtml(v.message)}${reason}</li>`
  })
  return `<ul class="v">${items.join('')}</ul>`
}

// The report sits three levels below the repo root, which the guide's paths are relative to.
const REPO_ROOT_FROM_REPORT = '../../../'

function renderWhereToLook(run: RunReport): string {
  const rules = [...new Set(run.unexplained.map((v) => v.rule))]
  if (!rules.length) {
    return ''
  }
  const items = rules.map((rule) => {
    const guide = RULE_GUIDE[rule]
    const { title, section } = RESPONSIBILITIES[guide.responsibility]
    return `<li><code>${escapeHtml(rule)}</code>: ${escapeHtml(guide.meaning)}
<span class="reason">Usual cause: ${escapeHtml(guide.cause)}</span>
<span class="reason">Responsibility: <a href="${escapeHtml(REPO_ROOT_FROM_REPORT + section)}">${escapeHtml(title)}</a> (${escapeHtml(section)})</span></li>`
  })
  return `<div class="look"><strong>Where to look</strong><ul>${items.join('')}</ul></div>`
}

function renderStale(gap: KnownGap): string {
  return `<p class="fail"><strong>Stale gap</strong> (${escapeHtml(
    gap.rules.join(', ')
  )}): ${escapeHtml(gap.reason)}</p>`
}

function violationKey(v: Violation): string {
  return JSON.stringify([
    v.rule,
    v.message,
    v.subject?.kind,
    v.subject?.timestamp
  ])
}
