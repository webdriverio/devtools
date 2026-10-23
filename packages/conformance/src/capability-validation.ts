import { KNOWN_GAPS } from './allowlist.js'
import {
  ADAPTER_COLUMNS,
  CAPABILITIES,
  INTERNAL_RULES
} from './capabilities.js'
import { optionProblems } from './capability-options.js'
import { RULES } from './constants.js'
import type { AdapterId, Capability, Cell, RuleId } from './types.js'

/** Problems the declaration can have that its types cannot rule out; empty when it is sound. */
export function validateCapabilities(
  capabilities: Capability[] = CAPABILITIES,
  internalRules: Partial<Record<RuleId, string>> = INTERNAL_RULES
): string[] {
  return [
    ...rowProblems(capabilities),
    ...ruleCoverageProblems(capabilities, internalRules),
    ...optionProblems(capabilities)
  ]
}

/** Per row: a cell for every adapter, a reason where one is due, real rules behind every proven cell. */
export function rowProblems(capabilities: Capability[]): string[] {
  const problems: string[] = []
  const known = new Set<string>(Object.values(RULES))
  const ids = new Set<string>()
  for (const capability of capabilities) {
    if (ids.has(capability.id)) {
      problems.push(`${capability.id}: declared twice`)
    }
    ids.add(capability.id)
    if (capability.tables.length === 0) {
      problems.push(`${capability.id}: appears in no table`)
    }
    for (const { id: adapter } of ADAPTER_COLUMNS) {
      const cell = capability.cells[adapter]
      if (!cell) {
        problems.push(`${capability.id}: no cell for ${adapter}`)
        continue
      }
      problems.push(
        ...cellProblems(cell, adapter, known).map(
          (p) => `${capability.id} / ${adapter}: ${p}`
        )
      )
    }
  }
  return problems
}

/** Every conformance rule backs some proven cell, or is listed as internal with a reason. */
export function ruleCoverageProblems(
  capabilities: Capability[],
  internalRules: Partial<Record<RuleId, string>>
): string[] {
  const proving = new Set<RuleId>(
    capabilities.flatMap((c) =>
      Object.values(c.cells).flatMap((cell) =>
        cell.support === 'proven' ? cell.rules : []
      )
    )
  )
  return (Object.values(RULES) as RuleId[]).flatMap((rule) => {
    const internal = internalRules[rule]
    if (internal !== undefined && !internal.trim()) {
      return [`rule ${rule}: internal without a reason`]
    }
    if (proving.has(rule) && internal !== undefined) {
      return [`rule ${rule}: listed as internal but proves a cell`]
    }
    return proving.has(rule) || internal !== undefined
      ? []
      : [`rule ${rule}: proves no capability and is not listed as internal`]
  })
}

function cellProblems(
  cell: Cell,
  adapter: AdapterId,
  known: Set<string>
): string[] {
  if (cell.support === 'partial' || cell.support === 'unsupported') {
    return cell.reason.trim() ? [] : ['a reason is required']
  }
  if (cell.support !== 'proven') {
    return []
  }
  if (cell.rules.length === 0) {
    return ['proven by no rule']
  }
  return cell.rules.flatMap((rule) => {
    if (!known.has(rule)) {
      return [`unknown rule ${rule}`]
    }
    const gap = KNOWN_GAPS.find(
      (g) => g.adapter === adapter && g.rules.includes(rule)
    )
    return gap ? [`${rule} is a known gap (bidi: ${gap.bidi})`] : []
  })
}
