import { FEATURES } from '../../../features.js'
import { ADAPTER_COLUMNS } from './capabilities.js'
import { isConformanceTested } from './capability-helpers.js'
import { GENERATED_NOTICE, LEGEND, SUPERSCRIPTS } from './constants.js'
import type { CapabilityTable, Cell, Feature } from './types.js'

export function superscript(n: number): string {
  return String(n)
    .split('')
    .map((digit) => SUPERSCRIPTS[Number(digit)])
    .join('')
}

export const markerFor = (table: CapabilityTable, edge: 'start' | 'end') =>
  `<!-- capability-matrix:${table}:${edge} -->`

function mark(cell: Cell): string {
  switch (cell.support) {
    case 'supported':
      return isConformanceTested(cell) ? '✅ tested' : '✅'
    case 'partial':
      return '⚠️'
    case 'unsupported':
      return '❌'
  }
}

/** One table, with each distinct reason numbered once in the order it first appears. */
export function renderTable(
  table: CapabilityTable,
  features: readonly Feature[] = FEATURES
): string {
  const rows = features.filter((f) => f.tables.includes(table))
  const reasons: string[] = []
  const footnote = (reason: string) => {
    const index = reasons.indexOf(reason)
    if (index !== -1) {
      return index + 1
    }
    reasons.push(reason)
    return reasons.length
  }
  const cellText = (cell: Cell) => {
    const parts = [mark(cell)]
    if (cell.label) {
      parts.push(cell.label)
    }
    if (cell.support !== 'supported') {
      parts.push(superscript(footnote(cell.reason)))
    }
    return parts.join(' ')
  }
  const lines = [
    `| Feature | ${ADAPTER_COLUMNS.map((a) => a.title).join(' | ')} |`,
    `|---|${ADAPTER_COLUMNS.map(() => '---').join('|')}|`,
    ...rows.map(
      (row) =>
        `| ${row.name} | ${ADAPTER_COLUMNS.map((a) => cellText(row.cells[a.id])).join(' | ')} |`
    )
  ]
  const blocks = [lines.join('\n'), LEGEND]
  if (reasons.length) {
    blocks.push(...reasons.map((r, i) => `${superscript(i + 1)} ${r}`))
  }
  return blocks.join('\n\n')
}

/** The full marker block, as it sits in a page. */
export function renderBlock(
  table: CapabilityTable,
  features?: readonly Feature[]
): string {
  return [
    markerFor(table, 'start'),
    GENERATED_NOTICE,
    '',
    renderTable(table, features),
    '',
    markerFor(table, 'end')
  ].join('\n')
}

/** Replaces the page's one marker block for this table; throws, naming the problem, when it has none, two, or a reversed pair. */
export function replaceBlock(
  page: string,
  table: CapabilityTable,
  features?: readonly Feature[]
): string {
  const startMarker = markerFor(table, 'start')
  const endMarker = markerFor(table, 'end')
  const starts = page.split(startMarker).length - 1
  const ends = page.split(endMarker).length - 1
  if (starts === 0 && ends === 0) {
    throw new Error(
      `no ${table} table; insert the lines ${startMarker} and ${endMarker} where it belongs`
    )
  }
  if (starts !== 1 || ends !== 1) {
    throw new Error(
      `${starts} start and ${ends} end markers for ${table}; keep exactly one ${startMarker} and one ${endMarker}`
    )
  }
  const start = page.indexOf(startMarker)
  const end = page.indexOf(endMarker)
  if (end < start) {
    throw new Error(`${endMarker} comes before ${startMarker}`)
  }
  return (
    page.slice(0, start) +
    renderBlock(table, features) +
    page.slice(end + endMarker.length)
  )
}

/** Each feature some adapter lacks, with that adapter's mark and reason, then a count of the evidence behind every cell. */
export function renderParity(features: readonly Feature[] = FEATURES): string {
  const gaps = features.filter((f) =>
    ADAPTER_COLUMNS.some((a) => f.cells[a.id].support !== 'supported')
  )
  const lines = [
    `Features not supported by every adapter: ${gaps.length} of ${features.length}`
  ]
  for (const row of gaps) {
    lines.push('', `${row.id}: ${row.name}`)
    for (const { id, title } of ADAPTER_COLUMNS) {
      const cell = row.cells[id]
      if (cell.support !== 'supported') {
        const shown = [mark(cell), cell.label].filter(Boolean).join(' ')
        lines.push(`  ${title}: ${shown}. ${cell.reason}`)
      }
    }
  }
  const counts = { rule: 0, test: 0, manual: 0, gap: 0 }
  for (const row of features) {
    for (const { id } of ADAPTER_COLUMNS) {
      const cell = row.cells[id]
      counts[cell.support === 'supported' ? cell.evidence.kind : 'gap']++
    }
  }
  lines.push(
    '',
    `Cells: ${counts.rule} conformance-tested, ${counts.test} unit-tested, ${counts.manual} checked by hand, ${counts.gap} partial or unsupported`
  )
  return lines.join('\n')
}
