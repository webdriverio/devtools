/**
 * Two unrelated events share the `clearExecutionData` scope: a run STARTING,
 * and a single entry resetting inside a run already in flight (Nightwatch
 * re-emits a cucumber scenario suite that way). Only the sender can tell them
 * apart, so the run route marks its own with `runStart` and the dashboard stops
 * inferring intent from the uid — inferring it is what made the second rerun of
 * a session keep the first one's actions, console and network rows.
 *
 * This asserts the flag actually leaves the backend: the app-side fix reads it,
 * so dropping it here would silently restore the bug with every app test still
 * green.
 */

import os from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WebSocket } from 'ws'
import type { FastifyInstance } from 'fastify'
import { WS_PATHS, WS_SCOPE } from '@wdio/devtools-shared'
import { start } from '../src/index.js'
import * as utils from '../src/utils.js'

vi.mock('../src/utils.js', () => ({
  getDevtoolsApp: vi.fn(),
  getCollectorSource: vi.fn()
}))

const WAIT_TIMEOUT_MS = 2000

let server: FastifyInstance | undefined

afterEach(async () => {
  await server?.close()
  server = undefined
  vi.restoreAllMocks()
})

async function bootWithClient(): Promise<{
  server: FastifyInstance
  frames: Array<{ scope: string; data: Record<string, unknown> }>
}> {
  vi.mocked(utils.getDevtoolsApp).mockResolvedValue(os.tmpdir())
  vi.mocked(utils.getCollectorSource).mockResolvedValue('// collector')
  const started = await start({ port: 0 })
  server = started.server

  // A real dashboard client, because the flag travels over the socket rather
  // than in the POST response — popouts see nothing else.
  const socket = new WebSocket(
    `ws://localhost:${started.port}${WS_PATHS.client}`
  )
  const frames: Array<{ scope: string; data: Record<string, unknown> }> = []
  socket.on('message', (raw) => frames.push(JSON.parse(String(raw))))
  await new Promise<void>((resolve, reject) => {
    socket.once('open', () => resolve())
    socket.once('error', reject)
  })
  return { server: started.server, frames }
}

async function clearFrame(
  frames: Array<{ scope: string; data: Record<string, unknown> }>
): Promise<Record<string, unknown>> {
  const deadline = Date.now() + WAIT_TIMEOUT_MS
  while (Date.now() < deadline) {
    const found = frames.find(
      (frame) => frame.scope === WS_SCOPE.clearExecutionData
    )
    if (found) {
      return found.data
    }
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error('timed out waiting for a clearExecutionData frame')
}

describe('a run start announces itself as one', () => {
  it('marks the clear it broadcasts with runStart', async () => {
    const { server: app, frames } = await bootWithClient()
    const { testRunner } = await import('../src/runner.js')
    vi.spyOn(testRunner, 'run').mockResolvedValue()

    const response = await app.inject({
      method: 'POST',
      url: '/api/tests/run',
      payload: {
        uid: 'examples/test_login.py',
        entryType: 'suite'
      }
    })

    expect(response.statusCode).toBe(200)
    expect(await clearFrame(frames)).toEqual({
      uid: 'examples/test_login.py',
      entryType: 'suite',
      runStart: true
    })
  })
})
