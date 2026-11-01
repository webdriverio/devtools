import { describe, it, expect } from 'vitest'

import {
  getSearchableLabel,
  entryPassesFilter
} from '../src/components/sidebar/tree-filter.js'
import type { TestEntry } from '../src/components/sidebar/types.js'

const entry = (overrides: Partial<TestEntry> = {}): TestEntry => ({
  uid: overrides.label ?? 'e',
  label: 'entry',
  type: 'test',
  children: [],
  ...overrides
})

describe('getSearchableLabel', () => {
  it('returns a leaf label', () => {
    expect(getSearchableLabel(entry({ label: 'login works' }))).toEqual([
      'login works'
    ])
  })

  it('flattens descendant labels for a suite', () => {
    const tree = entry({
      label: 'suite',
      type: 'suite',
      children: [
        entry({ label: 'a' }),
        entry({
          label: 'nested',
          type: 'suite',
          children: [entry({ label: 'b' })]
        })
      ]
    })
    expect(getSearchableLabel(tree)).toEqual(['a', 'b'])
  })
})

describe('entryPassesFilter', () => {
  it('passes everything with no query and no status', () => {
    expect(entryPassesFilter(entry({ state: 'failed' }), '', null)).toBe(true)
  })

  it('matches a leaf by case-insensitive query against its label', () => {
    const leaf = entry({ label: 'Secure Login' })
    expect(entryPassesFilter(leaf, 'secure', null)).toBe(true)
    expect(entryPassesFilter(leaf, 'logout', null)).toBe(false)
  })

  it('matches a suite by any descendant label', () => {
    const suite = entry({
      label: 'suite',
      type: 'suite',
      children: [entry({ label: 'checkout flow' })]
    })
    expect(entryPassesFilter(suite, 'checkout', null)).toBe(true)
  })

  it('keeps only leaves whose state matches the status filter', () => {
    expect(entryPassesFilter(entry({ state: 'passed' }), '', 'passed')).toBe(
      true
    )
    expect(entryPassesFilter(entry({ state: 'failed' }), '', 'passed')).toBe(
      false
    )
  })

  it('keeps a suite that still has children so matching cases stay reachable', () => {
    const suite = entry({
      label: 'suite',
      type: 'suite',
      state: 'failed',
      children: [entry({ label: 'passing case', state: 'passed' })]
    })
    // The suite itself is failed, but it survives because a child remained.
    expect(entryPassesFilter(suite, '', 'passed')).toBe(true)
  })

  it('combines query and status — both must hold for a leaf', () => {
    const leaf = entry({ label: 'login', state: 'passed' })
    expect(entryPassesFilter(leaf, 'login', 'passed')).toBe(true)
    expect(entryPassesFilter(leaf, 'login', 'failed')).toBe(false)
    expect(entryPassesFilter(leaf, 'logout', 'passed')).toBe(false)
  })
})
