// Layer A — cross-adapter capture parity. Loads each committed golden trace.zip
// through the real backend reader, reduces it to a capture summary, and
// snapshots it. No browser: it reads fixtures produced by `pnpm fixtures:regen`.
//
// A fixture that isn't present yet (fresh clone / CI before a regen) skips its
// entry, so the suite is green without fixtures and meaningful once they exist.
// A capture change surfaces as a snapshot diff on that adapter — accept it with
// `pnpm verify:update` (an intended change) or fix it (a regression).

import { existsSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { readTraceZip } from '../../packages/backend/src/trace-reader.js'
import { fixtureTrace } from '../support/paths.js'

import { READY_ENTRIES } from './matrix.js'
import { summarizeCapture } from './summarize.js'

for (const entry of READY_ENTRIES) {
  const fixture = fixtureTrace(entry.id)
  const present = existsSync(fixture)

  describe.skipIf(!present)(`${entry.label} [${entry.id}]`, () => {
    it('captures a consistent trace shape', async () => {
      const data = await readTraceZip(fixture)
      expect(summarizeCapture(data)).toMatchSnapshot()
    })
  })
}
