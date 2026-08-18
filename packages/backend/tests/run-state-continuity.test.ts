/**
 * The run-state seam. One test run opens a fresh worker socket per spec file,
 * so the backend has to tell "next spec of this run" apart from "a new run".
 * Reading a new spec as a new run empties the baseline accumulator mid-run and
 * Preserve & Rerun 409s for every spec except the last one that ran — a break
 * no unit test sees, because each side works correctly in isolation.
 */

import os from 'node:os'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { WebSocket } from 'ws'
import type { FastifyInstance } from 'fastify'
import {
  BASELINE_API,
  WORKER_WS_QUERY,
  WS_PATHS,
  type BaselinePreserveResponse
} from '@wdio/devtools-shared'
import { start } from '../src/index.js'
import { baselineStore } from '../src/baselineStore.js'
import * as utils from '../src/utils.js'

vi.mock('../src/utils.js', () => ({
  getDevtoolsApp: vi.fn(),
  getCollectorSource: vi.fn()
}))

const WAIT_TIMEOUT_MS = 2000

let server: FastifyInstance | undefined

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

/** The run every worker in a test belongs to unless it says otherwise. */
const RUN_ID = 'run-under-test'

interface WorkerOptions {
  runId?: string | null
  reconnect?: boolean
}

/** Open a worker socket the way `SessionCapturerBase` does. `runId: null`
 *  stands in for an adapter too old to send one. */
async function connectWorker(
  port: number,
  opts: WorkerOptions = {}
): Promise<WebSocket> {
  const runId = opts.runId === undefined ? RUN_ID : opts.runId
  const query = new URLSearchParams({
    ...(runId ? { [WORKER_WS_QUERY.runId]: runId } : {}),
    ...(opts.reconnect ? { [WORKER_WS_QUERY.reconnect]: '1' } : {})
  })
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

interface SpecReport {
  suiteUid: string
  testUid: string
  file: string
  start: number
  state?: 'passed' | 'failed'
}

/** One spec file's report: a suite holding a single test, plus the commands
 *  that ran inside that test's time window. */
function specEvents(spec: SpecReport) {
  const end = spec.start + 100
  const state = spec.state ?? 'passed'
  return {
    suites: [
      {
        [spec.suiteUid]: {
          uid: spec.suiteUid,
          title: `suite ${spec.file}`,
          file: spec.file,
          start: spec.start,
          end,
          state,
          tests: [
            {
              uid: spec.testUid,
              title: 'logs in',
              fullTitle: `suite ${spec.file} logs in`,
              start: spec.start,
              end,
              state
            }
          ],
          suites: []
        }
      }
    ],
    commands: [
      { timestamp: spec.start + 10, command: 'url', args: [spec.file] },
      { timestamp: spec.start + 20, command: 'click', args: ['#login'] }
    ]
  }
}

/** Stream a spec's events over `socket` and wait until the store has them.
 *  Waiting on the store rather than a timer also orders the assertions: the
 *  message handler is registered at the END of the connect handler, so data
 *  becoming visible proves the connect handler already ran. */
async function reportSpec(socket: WebSocket, spec: SpecReport): Promise<void> {
  const events = specEvents(spec)
  socket.send(JSON.stringify({ scope: 'suites', data: events.suites }))
  socket.send(JSON.stringify({ scope: 'commands', data: events.commands }))
  await waitFor(
    () => Boolean(baselineStore.snapshot(spec.testUid, 'test')),
    `the backend to record ${spec.file}`
  )
}

async function preserve(
  target: FastifyInstance,
  testUid: string
): Promise<{ statusCode: number; body: string }> {
  const res = await target.inject({
    method: 'POST',
    url: BASELINE_API.preserve,
    payload: { testUid, scope: 'test' }
  })
  return { statusCode: res.statusCode, body: res.body }
}

const FAILING_SPEC: SpecReport = {
  suiteUid: 'suite-login-fail',
  testUid: 'test-login-fail',
  file: '/login-fail.e2e.ts',
  start: 1000,
  state: 'failed'
}

const PASSING_SPEC: SpecReport = {
  suiteUid: 'suite-login',
  testUid: 'test-login',
  file: '/login.e2e.ts',
  start: 2000
}

describe('run state across worker connects', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    baselineStore.resetActiveRun()
  })

  afterEach(async () => {
    await server?.close()
    server = undefined
    baselineStore.resetActiveRun()
  })

  it('keeps an earlier spec preservable after the next spec opens its own worker socket', async () => {
    const { server: target, port } = await boot()

    const workerA = await connectWorker(port)
    await reportSpec(workerA, FAILING_SPEC)
    await closeWorker(workerA)

    // A second spec file means a second worker process, so a brand new socket
    // with no rerun flag and no reconnect marker — the case that regressed.
    const workerB = await connectWorker(port)
    await reportSpec(workerB, PASSING_SPEC)

    const res = await preserve(target, FAILING_SPEC.testUid)
    expect(res.statusCode).toBe(200)

    // The preserved window holds the first spec's commands only — a fix that
    // kept the data but merged both specs into one bucket would fail here.
    const { attempt } = JSON.parse(res.body) as BaselinePreserveResponse
    expect(attempt.commands.map((c) => c.command)).toEqual(['url', 'click'])
    expect(attempt.commands.map((c) => c.args?.[0])).toEqual([
      FAILING_SPEC.file,
      '#login'
    ])

    await closeWorker(workerB)
  })

  it('still preserves the spec whose worker is currently connected', async () => {
    const { server: target, port } = await boot()

    const workerA = await connectWorker(port)
    await reportSpec(workerA, FAILING_SPEC)
    await closeWorker(workerA)

    const workerB = await connectWorker(port)
    await reportSpec(workerB, PASSING_SPEC)

    const res = await preserve(target, PASSING_SPEC.testUid)
    expect(res.statusCode).toBe(200)

    await closeWorker(workerB)
  })

  it('keeps run state across a mid-run session-change reconnect', async () => {
    const { server: target, port } = await boot()

    const workerA = await connectWorker(port)
    await reportSpec(workerA, FAILING_SPEC)
    await closeWorker(workerA)

    const reconnected = await connectWorker(port, { reconnect: true })
    await reportSpec(reconnected, PASSING_SPEC)

    const res = await preserve(target, FAILING_SPEC.testUid)
    expect(res.statusCode).toBe(200)

    await closeWorker(reconnected)
  })

  it('drops a previous run when a new run connects', async () => {
    const { server: target, port } = await boot()

    const workerA = await connectWorker(port)
    await reportSpec(workerA, FAILING_SPEC)
    await closeWorker(workerA)

    const nextRun = await connectWorker(port, { runId: 'a-later-run' })
    await reportSpec(nextRun, PASSING_SPEC)

    const res = await preserve(target, FAILING_SPEC.testUid)
    expect(res.statusCode).toBe(409)

    await closeWorker(nextRun)
  })

  it('drops a previous run when the worker reports no run id', async () => {
    const { server: target, port } = await boot()

    const workerA = await connectWorker(port)
    await reportSpec(workerA, FAILING_SPEC)
    await closeWorker(workerA)

    const unidentified = await connectWorker(port, { runId: null })
    await reportSpec(unidentified, PASSING_SPEC)

    const res = await preserve(target, FAILING_SPEC.testUid)
    expect(res.statusCode).toBe(409)

    await closeWorker(unidentified)
  })

  it('refuses a uid the run never reported', async () => {
    const { server: target, port } = await boot()

    const workerA = await connectWorker(port)
    await reportSpec(workerA, FAILING_SPEC)

    const res = await preserve(target, 'test-never-ran')
    expect(res.statusCode).toBe(409)

    await closeWorker(workerA)
  })
})
