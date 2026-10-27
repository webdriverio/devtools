import { readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { KNOWN_GAPS } from '../src/allowlist.js'
import { KNOWN_DEBT, REPO_ROOT } from '../src/constants.js'

const claudeMd = readFileSync(path.join(REPO_ROOT, 'CLAUDE.md'), 'utf8')

describe('known gap reasons', () => {
  // A reason pointing at an entry that was renamed or removed sends the reader nowhere.
  it.each(Object.entries(KNOWN_DEBT))(
    '%s names a Known debt entry that exists',
    (_, reason) => {
      const entry = /Known debt: "([^"]+)"/.exec(reason)?.[1]
      expect(entry, reason).toBeDefined()
      expect(claudeMd).toContain(`**${entry}`)
    }
  )

  it('every scenario gap states its reason through a Known debt entry', () => {
    const reasons = new Set<string>(Object.values(KNOWN_DEBT))
    const scoped = KNOWN_GAPS.filter(
      (g) => g.only || g.lacksSteps || g.lacksTargets
    )
    expect(scoped.length).toBeGreaterThan(0)
    expect(scoped.filter((g) => !reasons.has(g.reason))).toEqual([])
  })
})
