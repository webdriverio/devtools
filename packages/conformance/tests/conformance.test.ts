import { beforeAll, describe, expect, it } from 'vitest'

import { ADAPTERS } from '../src/adapters.js'
import { compareRuns, judgeDivergences } from '../src/agreement.js'
import { runAdapter } from '../src/harness.js'
import { writeRunReports } from '../src/report.js'
import type { AdapterId, RunReport } from '../src/types.js'

const MODES = [true, false]
// Only a local run may skip an adapter whose prerequisites are missing; CI has them all.
const active = new Set<AdapterId>(
  ADAPTERS.filter((a) => process.env.CI || a.ready()).map((a) => a.id)
)
const reports: RunReport[] = []
const reportFor = (id: AdapterId, bidi: boolean) =>
  reports.find((r) => r.adapter === id && r.bidi === bidi)

// Sequential, so one scenario's timing never depends on another sharing the machine.
beforeAll(async () => {
  for (const adapter of ADAPTERS.filter((a) => active.has(a.id))) {
    for (const bidi of MODES) {
      reports.push(await runAdapter(adapter, bidi))
    }
  }
  await writeRunReports(reports)
}, 300_000)

describe.each(ADAPTERS.map((a) => a.id))('%s', (id) => {
  it.skipIf(!active.has(id)).each(MODES)(
    'follows every rule (bidi: %s)',
    (bidi) => {
      const run = reportFor(id, bidi)
      expect(run?.exitCode, run?.output).toBe(0)
      expect(
        run?.checkerError,
        'the checker could not read this stream'
      ).toBeUndefined()
      expect(run?.truth.documents.length).toBe(3)
      expect(run?.unexplained).toEqual([])
      expect(run?.stale, 'a known gap no longer occurs: remove it').toEqual([])
    }
  )
})

describe('adapters agree', () => {
  it.skipIf(active.size < 2).each(MODES)(
    'tell the same story for the same scenario (bidi: %s)',
    (bidi) => {
      const runs = reports.filter((r) => r.bidi === bidi && !r.checkerError)
      const { unexplained, stale } = judgeDivergences(compareRuns(runs), runs)
      expect(unexplained).toEqual([])
      expect(stale, 'a known difference no longer occurs: remove it').toEqual(
        []
      )
    }
  )
})
