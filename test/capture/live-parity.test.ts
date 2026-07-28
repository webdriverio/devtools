// Layer A (live mode) — cross-adapter parity for the streamed WS event feed.
// Loads each committed live-events.json (recorded by `pnpm fixtures:record-live`),
// reduces it to a scope + command-vocabulary summary, and snapshots it per
// adapter. Skips an entry whose live fixture is absent, so the suite is green
// before the first recording and meaningful once fixtures exist — mirroring
// trace-parity for live mode.

import { existsSync, readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { fixtureLiveEvents } from '../support/paths.js'

import { READY_ENTRIES } from './matrix.js'
import { summarizeLive, type LiteMessage } from './live-summarize.js'

for (const entry of READY_ENTRIES) {
  const fixture = fixtureLiveEvents(entry.id)
  const present = existsSync(fixture)

  describe.skipIf(!present)(`${entry.label} [${entry.id}] (live)`, () => {
    it('streams a consistent live event shape', () => {
      const messages = JSON.parse(
        readFileSync(fixture, 'utf8')
      ) as LiteMessage[]
      expect(summarizeLive(messages)).toMatchSnapshot()
    })
  })
}
