/**
 * The worker control frame that asks the backend to build a trace.
 *
 * Two properties matter more than the happy path. An export happens while the
 * adapter is finishing a run, so a failure has to come back as a message rather
 * than an unhandled rejection; and a frame missing its fields must be refused
 * outright, since the fields name the directory written to.
 */

import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, it, expect, vi } from 'vitest'
import { TRACE_EXPORT_SCOPE } from '@wdio/devtools-shared'
import {
  asTraceExportRequest,
  runTraceExport,
  tryHandleTraceExportMessage
} from '../src/trace-export-message.js'
import { freshRun } from '../src/baseline/utils.js'
import type { ActiveRun } from '../src/baseline/types.js'

const dirs: string[] = []

afterEach(async () => {
  await Promise.all(
    dirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true }))
  )
})

async function tmpDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'trace-export-msg-'))
  dirs.push(dir)
  return dir
}

function run(overrides: Partial<ActiveRun> = {}): ActiveRun {
  return {
    ...freshRun(),
    commands: [{ command: 'click', args: ['#go'], timestamp: 1200 }],
    ...overrides
  }
}

function deps(activeRun: ActiveRun = run()) {
  const replyToWorker = vi.fn()
  return {
    replyToWorker,
    deps: { activeRun: () => activeRun, replyToWorker }
  }
}

/** The single reply frame, parsed. */
function reply(replyToWorker: ReturnType<typeof vi.fn>) {
  expect(replyToWorker).toHaveBeenCalledTimes(1)
  return JSON.parse(replyToWorker.mock.calls[0]![0] as string)
}

describe('asTraceExportRequest', () => {
  it('accepts a frame carrying all three required fields', () => {
    expect(
      asTraceExportRequest({
        requestId: 'r1',
        outputDir: '/tmp/out',
        sessionId: 's1'
      })
    ).toEqual({ requestId: 'r1', outputDir: '/tmp/out', sessionId: 's1' })
  })

  // Each of these would otherwise reach the writer as `undefined` and put a
  // `trace-undefined.zip` into a directory literally named "undefined".
  it('refuses a frame missing any required field, or carrying a non-string', () => {
    const full = { requestId: 'r1', outputDir: '/tmp/out', sessionId: 's1' }
    for (const key of ['requestId', 'outputDir', 'sessionId'] as const) {
      const partial = { ...full }
      delete partial[key]
      expect(asTraceExportRequest(partial)).toBeUndefined()
      expect(asTraceExportRequest({ ...full, [key]: 42 })).toBeUndefined()
    }
    expect(asTraceExportRequest(undefined)).toBeUndefined()
  })
})

describe('tryHandleTraceExportMessage', () => {
  it('ignores frames of any other scope', () => {
    const { deps: d, replyToWorker } = deps()
    expect(
      tryHandleTraceExportMessage({ scope: 'commands', data: {} }, d)
    ).toBe(false)
    expect(tryHandleTraceExportMessage({ scope: undefined }, d)).toBe(false)
    expect(replyToWorker).not.toHaveBeenCalled()
  })

  // Claimed, not forwarded: a malformed export request is still an export
  // request, and passing it on would broadcast it to every dashboard client.
  it('claims a malformed request without exporting or replying', () => {
    const { deps: d, replyToWorker } = deps()
    expect(
      tryHandleTraceExportMessage(
        { scope: TRACE_EXPORT_SCOPE.request, data: { requestId: 'r1' } },
        d
      )
    ).toBe(true)
    expect(replyToWorker).not.toHaveBeenCalled()
  })

  it('claims a well-formed request', async () => {
    const outputDir = await tmpDir()
    const { deps: d } = deps()
    expect(
      tryHandleTraceExportMessage(
        {
          scope: TRACE_EXPORT_SCOPE.request,
          data: { requestId: 'r1', outputDir, sessionId: 's1' }
        },
        d
      )
    ).toBe(true)
  })
})

describe('runTraceExport', () => {
  it('replies with the artifact path, under the result scope', async () => {
    const outputDir = await tmpDir()
    const { deps: d, replyToWorker } = deps()

    await runTraceExport({ requestId: 'r1', outputDir, sessionId: 'sess-1' }, d)

    const frame = reply(replyToWorker)
    expect(frame.scope).toBe(TRACE_EXPORT_SCOPE.result)
    expect(frame.data.requestId).toBe('r1')
    expect(frame.data.path).toBe(path.join(outputDir, 'trace-sess-1.zip'))
    expect(frame.data.error).toBeUndefined()
    // The path is only worth reporting if something is actually there.
    await expect(fs.stat(frame.data.path)).resolves.toBeTruthy()
  })

  it('reports a failure as a reply rather than rejecting', async () => {
    const { deps: d, replyToWorker } = deps(run({ commands: [] }))

    await expect(
      runTraceExport(
        { requestId: 'r2', outputDir: await tmpDir(), sessionId: 'sess-2' },
        d
      )
    ).resolves.toBeUndefined()

    const frame = reply(replyToWorker)
    expect(frame.data.requestId).toBe('r2')
    expect(frame.data.error).toMatch(/nothing captured/)
    expect(frame.data.path).toBeUndefined()
  })

  it('reports an unwritable directory instead of taking the run down', async () => {
    const { deps: d, replyToWorker } = deps()
    const missing = path.join(await tmpDir(), 'no', 'such', '\0bad')

    await expect(
      runTraceExport(
        { requestId: 'r3', outputDir: missing, sessionId: 'sess-3' },
        d
      )
    ).resolves.toBeUndefined()

    expect(reply(replyToWorker).data.error).toBeTruthy()
  })

  // The socket closing before the artifact is written is ordinary at the end of
  // a run; the export still has to complete rather than throw on the reply.
  it('completes with no reply channel at all', async () => {
    const outputDir = await tmpDir()
    await expect(
      runTraceExport(
        { requestId: 'r4', outputDir, sessionId: 'sess-4' },
        { activeRun: () => run() }
      )
    ).resolves.toBeUndefined()
    expect(await fs.readdir(outputDir)).toEqual(['trace-sess-4.zip'])
  })
})

describe('a run the policy declines', () => {
  function passingRun() {
    return run({
      nodes: new Map([
        [
          't1',
          { uid: 't1', kind: 'test' as const, childUids: [], state: 'passed' }
        ]
      ])
    })
  }

  it('reports a decline, not an error', async () => {
    // The distinction is the whole point: a passing run under
    // retain-on-failure did exactly what was asked, and an `error` here makes
    // the adapter log a broken export for a run that succeeded.
    const { replyToWorker, deps: d } = deps(passingRun())

    await runTraceExport(
      {
        requestId: 'r1',
        outputDir: await tmpDir(),
        sessionId: 's1',
        tracePolicy: 'retain-on-failure'
      },
      d
    )

    const answer = reply(replyToWorker)
    expect(answer.data.declinedByPolicy).toBe(true)
    expect(answer.data.error).toBeUndefined()
    expect(answer.data.path).toBeUndefined()
  })

  it('writes nothing to the output directory', async () => {
    const dir = await tmpDir()
    const { deps: d } = deps(passingRun())

    await runTraceExport(
      {
        requestId: 'r1',
        outputDir: dir,
        sessionId: 's1',
        tracePolicy: 'retain-on-failure'
      },
      d
    )

    expect(await fs.readdir(dir)).toEqual([])
  })

  it('still writes when the policy retains', async () => {
    const failing = run({
      nodes: new Map([
        [
          't1',
          { uid: 't1', kind: 'test' as const, childUids: [], state: 'failed' }
        ]
      ])
    })
    const { replyToWorker, deps: d } = deps(failing)

    await runTraceExport(
      {
        requestId: 'r1',
        outputDir: await tmpDir(),
        sessionId: 's1',
        tracePolicy: 'retain-on-failure'
      },
      d
    )

    const answer = reply(replyToWorker)
    expect(answer.data.path).toMatch(/trace-s1\.zip$/)
    expect(answer.data.declinedByPolicy).toBeUndefined()
  })
})
