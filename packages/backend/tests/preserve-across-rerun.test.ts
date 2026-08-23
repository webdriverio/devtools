/**
 * Preserve & Rerun, end to end across the run boundary.
 *
 * The feature is two backend decisions that no test held: a run request must
 * KEEP the baselines when it was launched to compare against them, and the
 * preserved attempt must still be there once the rerun reports in — under a
 * NEW run id, because a rerun is a freshly spawned process rather than another
 * worker of the run that asked for it. That is the ordinary shape for the
 * Python adapter (its reruns are always a new process) and the
 * `specFileRetries` shape for WDIO.
 *
 * Both were verified by hand on the Python adapter and neither was covered:
 * `preserveBaseline` appeared in no test in the repo, so a wipe on the very
 * request that exists to avoid one would have looked exactly like a feature
 * that does nothing.
 */

import os from 'node:os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WebSocket } from 'ws'
import type { FastifyInstance } from 'fastify'
import {
  BASELINE_API,
  TESTS_API,
  WORKER_WS_QUERY,
  WS_PATHS
} from '@wdio/devtools-shared'
import { start } from '../src/index.js'
import { baselineStore } from '../src/baselineStore.js'
import * as utils from '../src/utils.js'

vi.mock('../src/utils.js', () => ({
  getDevtoolsApp: vi.fn(),
  getCollectorSource: vi.fn()
}))

const WAIT_TIMEOUT_MS = 2000
const SUITE_UID = 'examples/test_login.py'
const TEST_UID = 'examples/test_login.py::TestLogin::test_rejects_invalid'

let server: FastifyInstance | undefined

beforeEach(() => {
  baselineStore.resetActiveRun()
  baselineStore.clearAll()
})

afterEach(async () => {
  await server?.close()
  server = undefined
  vi.restoreAllMocks()
})

async function boot(): Promise<{ server: FastifyInstance; port: number }> {
  vi.mocked(utils.getDevtoolsApp).mockResolvedValue(os.tmpdir())
  vi.mocked(utils.getCollectorSource).mockResolvedValue('// collector')
  const started = await start({ port: 0 })
  server = started.server
  return started
}

async function waitFor(predicate: () => boolean, what: string): Promise<void> {
  const deadline = Date.now() + WAIT_TIMEOUT_MS
  while (Date.now() < deadline) {
    if (predicate()) {
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`timed out waiting for ${what}`)
}

async function connectWorker(port: number, runId: string): Promise<WebSocket> {
  const query = new URLSearchParams({ [WORKER_WS_QUERY.runId]: runId })
  const socket = new WebSocket(
    `ws://localhost:${port}${WS_PATHS.worker}?${query}`
  )
  await new Promise<void>((resolve, reject) => {
    socket.once('open', () => resolve())
    socket.once('error', reject)
  })
  return socket
}

async function closeWorker(socket: WebSocket): Promise<void> {
  await new Promise<void>((resolve) => {
    socket.once('close', () => resolve())
    socket.close()
  })
}

/** One attempt of one test: the suite tree plus the commands inside its
 *  window, in the order and shape an adapter sends them. */
async function reportAttempt(
  socket: WebSocket,
  opts: { start: number; state: 'passed' | 'failed'; command: string }
): Promise<void> {
  const end = opts.start + 100
  socket.send(
    JSON.stringify({
      scope: 'commands',
      data: [
        { timestamp: opts.start + 50, command: opts.command, args: [], id: 1 }
      ]
    })
  )
  socket.send(
    JSON.stringify({
      scope: 'suites',
      data: [
        {
          [SUITE_UID]: {
            uid: SUITE_UID,
            title: SUITE_UID,
            file: SUITE_UID,
            start: opts.start,
            end,
            state: opts.state,
            tests: [
              {
                uid: TEST_UID,
                title: 'test_rejects_invalid',
                fullTitle: `${SUITE_UID} › test_rejects_invalid`,
                start: opts.start,
                end,
                state: opts.state
              }
            ],
            suites: []
          }
        }
      ]
    })
  )
  await waitFor(
    () => Boolean(baselineStore.snapshot(TEST_UID, 'test')),
    'the backend to record the attempt'
  )
}

async function requestRun(
  target: FastifyInstance,
  preserveBaseline: boolean
): Promise<number> {
  const { testRunner } = await import('../src/runner.js')
  vi.spyOn(testRunner, 'run').mockResolvedValue()
  const res = await target.inject({
    method: 'POST',
    url: TESTS_API.run,
    payload: {
      uid: TEST_UID,
      entryType: 'test',
      preserveBaseline
    }
  })
  return res.statusCode
}

describe('preserve and rerun across the run boundary', () => {
  it('keeps the baseline when the run was launched to compare against it', async () => {
    const { server: target, port } = await boot()
    const first = await connectWorker(port, 'run-1')
    await reportAttempt(first, {
      start: 1000,
      state: 'failed',
      command: 'clickElement'
    })

    const preserved = await target.inject({
      method: 'POST',
      url: BASELINE_API.preserve,
      payload: { testUid: TEST_UID, scope: 'test' }
    })
    expect(preserved.statusCode).toBe(200)

    expect(await requestRun(target, true)).toBe(200)

    expect(baselineStore.get(TEST_UID)).toBeDefined()
    await closeWorker(first)
  })

  it('drops every baseline on a plain rerun, which hides the compare tab', async () => {
    // The other half of the same flag: a rerun nobody asked to compare must
    // not leave a stale baseline behind for the next one to diff against.
    const { server: target, port } = await boot()
    const first = await connectWorker(port, 'run-1')
    await reportAttempt(first, {
      start: 1000,
      state: 'failed',
      command: 'clickElement'
    })
    await target.inject({
      method: 'POST',
      url: BASELINE_API.preserve,
      payload: { testUid: TEST_UID, scope: 'test' }
    })

    expect(await requestRun(target, false)).toBe(200)

    expect(baselineStore.get(TEST_UID)).toBeUndefined()
    await closeWorker(first)
  })

  it('pairs the preserved attempt with a rerun that reports under a new run id', async () => {
    // The shape a spawned rerun actually has. The preserved attempt lives
    // outside the active-run accumulator, so a new run resets what is being
    // captured without touching what was already kept.
    const { server: target, port } = await boot()
    const first = await connectWorker(port, 'run-1')
    await reportAttempt(first, {
      start: 1000,
      state: 'failed',
      command: 'clickElement'
    })
    await target.inject({
      method: 'POST',
      url: BASELINE_API.preserve,
      payload: { testUid: TEST_UID, scope: 'test' }
    })
    await requestRun(target, true)
    await closeWorker(first)

    const rerun = await connectWorker(port, 'run-2-spawned-by-the-rerun')
    await reportAttempt(rerun, {
      start: 5000,
      state: 'passed',
      command: 'clickElement'
    })

    const pair = await target.inject({
      method: 'GET',
      url: `/api/baseline/${encodeURIComponent(TEST_UID)}?scope=test`
    })
    const { baseline, latest } = JSON.parse(pair.body)

    expect(baseline?.test?.state).toBe('failed')
    expect(latest?.test?.state).toBe('passed')
    // Two distinct attempts, not the same one twice: the diff has nothing to
    // show if both sides resolve to the current run.
    expect(baseline.window.start).not.toBe(latest.window.start)
    expect(baseline.commands).toHaveLength(1)
    expect(latest.commands).toHaveLength(1)

    await closeWorker(rerun)
  })
})
