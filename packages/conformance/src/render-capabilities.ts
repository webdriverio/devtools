import { ADAPTER_COLUMNS, CAPABILITIES } from './capabilities.js'
import { GENERATED_NOTICE, LEGEND, SUPERSCRIPTS } from './constants.js'
import type { Capability, CapabilityTable, Cell } from './types.js'

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
      return '✅'
    case 'proven':
      return '✅ tested'
    case 'partial':
      return '⚠️'
    case 'unsupported':
      return '❌'
  }
}

/** One table, with each distinct reason numbered once in the order it first appears. */
export function renderTable(
  table: CapabilityTable,
  capabilities: Capability[] = CAPABILITIES
): string {
  const rows = capabilities.filter((c) => c.tables.includes(table))
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
    if (cell.support === 'partial' || cell.support === 'unsupported') {
      parts.push(superscript(footnote(cell.reason)))
    }
    return parts.join(' ')
  }
  const lines = [
    `| Capability | ${ADAPTER_COLUMNS.map((a) => a.title).join(' | ')} |`,
    `|---|${ADAPTER_COLUMNS.map(() => '---').join('|')}|`,
    ...rows.map(
      (row) =>
        `| ${row.name} | ${ADAPTER_COLUMNS.map((a) => cellText(row.cells[a.id])).join(' | ')} |`
    )
  ]
  const hasProven = rows.some((row) =>
    ADAPTER_COLUMNS.some((a) => row.cells[a.id].support === 'proven')
  )
  const blocks = [lines.join('\n')]
  if (hasProven) {
    blocks.push(LEGEND)
  }
  if (reasons.length) {
    blocks.push(...reasons.map((r, i) => `${superscript(i + 1)} ${r}`))
  }
  return blocks.join('\n\n')
}

/** The full marker block, as it sits in a page. */
export function renderBlock(
  table: CapabilityTable,
  capabilities?: Capability[]
): string {
  return [
    markerFor(table, 'start'),
    GENERATED_NOTICE,
    '',
    renderTable(table, capabilities),
    '',
    markerFor(table, 'end')
  ].join('\n')
}

/** Replaces the page's one marker block for this table; throws, naming the problem, when it has none, two, or a reversed pair. */
export function replaceBlock(
  page: string,
  table: CapabilityTable,
  capabilities?: Capability[]
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
    renderBlock(table, capabilities) +
    page.slice(end + endMarker.length)
  )
}
