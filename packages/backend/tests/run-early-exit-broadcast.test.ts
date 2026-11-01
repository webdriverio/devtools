/**
 * A rerun whose process exits before any worker connects (a config preflight
 * refusing to start, a missing driver) used to leave the dashboard on
 * "Running" for good: the app leaves that state only on the worker's own
 * suites frames or on `testStopped`, and neither ever came. This drives a real
 * child through the run route and asserts the frame a real client receives.
 */

import os from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WebSocket } from 'ws'
import { quote as shellQuote } from 'shell-quote'
import type { FastifyInstance } from 'fastify'
import { WS_PATHS, WS_SCOPE } from '@wdio/devtools-shared'
import { start } from '../src/index.js'
import * as utils from '../src/utils.js'

vi.mock('../src/utils.js', () => ({
  getDevtoolsApp: vi.fn(),
  getCollectorSource: vi.fn()
}))

const WAIT_TIMEOUT_MS = 5000

let server: FastifyInstance | undefined

afterEach(async () => {
  await server?.close()
  server = undefined
  vi.restoreAllMocks()
})

type Frame = { scope: string; data: Record<string, unknown> }

async function bootWithClient(): Promise<{
  server: FastifyInstance
  frames: Frame[]
}> {
  vi.mocked(utils.getDevtoolsApp).mockResolvedValue(os.tmpdir())
  vi.mocked(utils.getCollectorSource).mockResolvedValue('// collector')
  const started = await start({ port: 0 })
  server = started.server
  const socket = new WebSocket(
    `ws://localhost:${started.port}${WS_PATHS.client}`
  )
  const frames: Frame[] = []
  socket.on('message', (raw) => frames.push(JSON.parse(String(raw))))
  await new Promise<void>((resolve, reject) => {
    socket.once('open', () => resolve())
    socket.once('error', reject)
  })
  return { server: started.server, frames }
}

async function frameFor(frames: Frame[], scope: string): Promise<Frame> {
  const deadline = Date.now() + WAIT_TIMEOUT_MS
  while (Date.now() < deadline) {
    const found = frames.find((frame) => frame.scope === scope)
    if (found) {
      return found
    }
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`timed out waiting for a ${scope} frame`)
}

describe('a run that exits before reporting', () => {
  it('tells the dashboard the run ended, and why', async () => {
    const { server: app, frames } = await bootWithClient()
    const exitsAtOnce = shellQuote([process.execPath, '-e', 'process.exit(3)'])

    const response = await app.inject({
      method: 'POST',
      url: '/api/tests/run',
      payload: {
        uid: 'examples/test_login.py::test_one',
        entryType: 'test',
        launchCommand: exitsAtOnce,
        rerunCommand: exitsAtOnce
      }
    })

    expect(response.statusCode).toBe(200)
    const stopped = await frameFor(frames, WS_SCOPE.testStopped)
    expect(stopped.data).toMatchObject({
      stopped: true,
      reason: 'Run exited before reporting (exit code 3)'
    })
  })
})
