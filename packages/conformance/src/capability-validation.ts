import { statSync } from 'node:fs'
import path from 'node:path'

import { FEATURES } from './features.js'
import { KNOWN_GAPS } from './allowlist.js'
import { ADAPTER_COLUMNS, INTERNAL_RULES } from './capabilities.js'
import {
  ADAPTER_TESTS,
  SHARED_TESTS,
  conformanceRules
} from './capability-helpers.js'
import { optionProblems } from './capability-options.js'
import { REPO_ROOT, RULES } from './constants.js'
import type { AdapterId, Cell, Feature, RuleId } from './types.js'

/** Problems the declaration can have that its types cannot rule out; empty when it is sound. */
export function validateFeatures(
  features: readonly Feature[] = FEATURES,
  internalRules: Partial<Record<RuleId, string>> = INTERNAL_RULES
): string[] {
  return [
    ...rowProblems(features),
    ...ruleCoverageProblems(features, internalRules),
    ...optionProblems(features)
  ]
}

/** Per row: a cell for every adapter, a reason where one is due, real evidence behind every supported cell. */
export function rowProblems(features: readonly Feature[]): string[] {
  const problems: string[] = []
  const known = new Set<string>(Object.values(RULES))
  const ids = new Set<string>()
  for (const feature of features) {
    if (ids.has(feature.id)) {
      problems.push(`${feature.id}: declared twice`)
    }
    ids.add(feature.id)
    if (feature.tables.length === 0) {
      problems.push(`${feature.id}: appears in no table`)
    }
    for (const { id: adapter } of ADAPTER_COLUMNS) {
      const cell = feature.cells[adapter]
      if (!cell) {
        problems.push(`${feature.id}: no cell for ${adapter}`)
        continue
      }
      problems.push(
        ...cellProblems(cell, adapter, known).map(
          (p) => `${feature.id} / ${adapter}: ${p}`
        )
      )
    }
  }
  return problems
}

/** Every conformance rule backs some tested cell, or is listed as internal with a reason. */
export function ruleCoverageProblems(
  features: readonly Feature[],
  internalRules: Partial<Record<RuleId, string>>
): string[] {
  const proving = new Set<RuleId>(
    features.flatMap((f) => Object.values(f.cells).flatMap(conformanceRules))
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
      : [`rule ${rule}: proves no feature and is not listed as internal`]
  })
}

const blank = (text: unknown) => typeof text !== 'string' || !text.trim()

function cellProblems(
  cell: Cell,
  adapter: AdapterId,
  known: Set<string>
): string[] {
  if (cell.support !== 'supported') {
    return blank(cell.reason) ? ['a reason is required'] : []
  }
  // The types rule these out; a cell built outside them (a cast, plain JS) is reported rather than crashing the run.
  const evidence = cell.evidence as unknown as
    Record<string, unknown> | undefined
  if (!evidence || typeof evidence !== 'object') {
    return ['supported without evidence']
  }
  switch (evidence.kind) {
    case 'manual':
      return blank(evidence.reason)
        ? ['manual evidence needs the reason no test covers it']
        : []
    case 'test':
      return testProblems(evidence.path, adapter)
    case 'rule':
      return ruleProblems(evidence.rules, adapter, known)
    default:
      return [`evidence of unknown kind ${String(evidence.kind)}`]
  }
}

function testProblems(test: unknown, adapter: AdapterId): string[] {
  if (blank(test)) {
    return ['test evidence names no file']
  }
  const relative = path.normalize(String(test))
  const allowed = [ADAPTER_TESTS[adapter], ...SHARED_TESTS]
  if (!allowed.some((dir) => relative.startsWith(dir))) {
    return [
      `test ${relative} is outside ${ADAPTER_TESTS[adapter]} and the shared packages' tests`
    ]
  }
  try {
    return statSync(path.join(REPO_ROOT, relative)).isFile()
      ? []
      : [`test ${relative} is not a file`]
  } catch {
    return [`test ${relative} does not exist`]
  }
}

function ruleProblems(
  rules: unknown,
  adapter: AdapterId,
  known: Set<string>
): string[] {
  if (!Array.isArray(rules) || rules.length === 0) {
    return ['rule evidence names no rule']
  }
  return rules.flatMap((rule: string) => {
    if (!known.has(rule)) {
      return [`unknown rule ${rule}`]
    }
    const gap = KNOWN_GAPS.find(
      (g) => g.adapter === adapter && g.rules.includes(rule as RuleId)
    )
    return gap ? [`${rule} is a known gap (bidi: ${gap.bidi})`] : []
  })
}
