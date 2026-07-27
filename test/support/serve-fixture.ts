// Layer B support: boot the real backend in trace-serve mode against a
// committed golden fixture so the WebdriverIO visual specs can drive the trace
// player. Mirrors show-trace.ts (readTraceZip → start({ trace })), but returns
// an instance-scoped close handle instead of opening a browser.

import { readTraceZip } from '../../packages/backend/src/trace-reader.js'
import { start } from '../../packages/backend/src/index.js'

import { fixtureTrace } from './paths.js'

export interface ServedFixture {
  url: string
  close: () => Promise<void>
}

/** Reconstruct the fixture trace, serve it, and hand back the player URL plus a
 *  close handle. `start()` resolves to `{ server, port }`, so `server.close()`
 *  is a real per-instance shutdown (the module-level `stop()` export closes the
 *  last-started server, which would race parallel/sequential specs). */
export async function serveFixture(id: string): Promise<ServedFixture> {
  const trace = await readTraceZip(fixtureTrace(id))
  const { server, port } = await start({ trace })
  return {
    url: `http://localhost:${port}`,
    close: () => server.close()
  }
}
