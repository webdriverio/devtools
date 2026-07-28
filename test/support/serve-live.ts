// Layer B support (live mode): boot the real backend with NO trace (live
// dashboard mode), stand in as the adapter by streaming a small synthetic event
// sequence over the worker WebSocket, and hand back the dashboard URL + a close
// handle. The counterpart of serve-fixture.ts, which serves a static trace.zip.
//
// Why synthetic and not a recorded fixture: the committed live-events.json is the
// lite parity projection (command names only, no payloads) — not replayable — and
// the raw stream is multi-MB. A hand-built handful of real SocketMessages renders
// non-empty panels deterministically. The backend buffers worker frames and
// replays them to the browser client on connect, so streaming before the page
// loads is fine.

import { readFileSync } from 'node:fs'
import path from 'node:path'

import { WebSocket } from 'ws'

import { start } from '../../packages/backend/src/index.js'
import { WS_PATHS } from '../../packages/shared/src/routes.js'
import type { SocketMessage } from '../../packages/shared/src/ws.js'

import { TEST_ROOT } from './paths.js'

export interface ServedLive {
  url: string
  close: () => Promise<void>
}

const SYNTHETIC = path.join(TEST_ROOT, 'fixtures', 'live-synthetic.json')

export async function serveLive(): Promise<ServedLive> {
  const { server, port } = await start({})
  const frames = JSON.parse(readFileSync(SYNTHETIC, 'utf8')) as SocketMessage[]

  const worker = new WebSocket(`ws://localhost:${port}${WS_PATHS.worker}`)
  await new Promise<void>((resolve, reject) => {
    worker.once('open', () => resolve())
    worker.once('error', reject)
  })
  for (const frame of frames) {
    worker.send(JSON.stringify(frame))
  }

  return {
    url: `http://localhost:${port}`,
    close: async () => {
      worker.close()
      await server.close()
    }
  }
}
