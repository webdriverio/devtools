// Layer B — live dashboard visual regression. SCAFFOLD ONLY.
//
// Unlike player.e2e.ts (which serves a static trace.zip), the live dashboard
// needs a worker WebSocket streaming a recorded event feed into the backend.
// That depends on Phase 1b: committed `fixtures/<id>/live-events.json` streams
// plus a live-serve helper that boots the backend without `{ trace }` and
// replays those events over the worker socket. Neither exists yet.
//
// This block stays skipped until then. Do NOT implement live serving here —
// it lands with Phase 1b so the harness has a real feed to replay.

import { READY_ENTRIES } from '../capture/matrix.js'

describe.skip('live dashboard (awaits Phase 1b live fixtures)', () => {
  for (const entry of READY_ENTRIES) {
    it(`matches the live dashboard for ${entry.label}`, () => {
      // Pending: serveLiveFixture(entry.id) → browser.url → snapshot panels.
    })
  }
})
