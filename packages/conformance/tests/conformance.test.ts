import { beforeAll, describe, expect, it } from 'vitest'

import { ADAPTERS } from '../src/adapters.js'
import { compareRuns, judgeDivergences } from '../src/agreement.js'
import { BIDI_MODES } from '../src/constants.js'
import { runAdapter } from '../src/harness.js'
import { writeRunReports } from '../src/report.js'
import type { AdapterId, BidiMode, RunReport } from '../src/types.js'

// Only a local run may skip an adapter whose prerequisites are missing; CI has them all.
const active = new Set<AdapterId>(
  ADAPTERS.filter((a) => process.env.CI || a.ready()).map((a) => a.id)
)
const reports: RunReport[] = []
const reportFor = (id: AdapterId, bidi: BidiMode) =>
  reports.find((r) => r.adapter === id && r.bidi === bidi)

// Sequential, so one scenario's timing never depends on another sharing the machine.
beforeAll(async () => {
  for (const adapter of ADAPTERS.filter((a) => active.has(a.id))) {
    for (const bidi of BIDI_MODES) {
      reports.push(await runAdapter(adapter, bidi))
    }
  }
  await writeRunReports(reports)
}, 450_000)

describe.each(ADAPTERS.map((a) => a.id))('%s', (id) => {
  it.skipIf(!active.has(id)).each(BIDI_MODES)(
    'follows every rule (bidi: %s)',
    (bidi) => {
      const run = reportFor(id, bidi)
      // Two tests fail by design; any other code is a crash, a usage error or a test ending other than designed.
      expect(run?.exitCode, run?.output).toBe(
        ADAPTERS.find((a) => a.id === id)!.exitCode
      )
      expect(
        run?.checkerError,
        'the checker could not read this stream'
      ).toBeUndefined()
      expect(run?.truth.documents.length).toBe(3)
      expect(run?.truth.requests.length).toBe(9)
      expect(run?.unexplained).toEqual([])
      expect(run?.stale, 'a known gap no longer occurs: remove it').toEqual([])
    }
  )
})

describe('adapters agree', () => {
  it.skipIf(active.size < 2).each(BIDI_MODES)(
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
