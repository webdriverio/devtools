// @vitest-environment happy-dom
//
// happy-dom has no Worker, so the worker's side of the protocol is tested as
// the plain function it runs, and the page's side against a stand-in Worker
// that runs that same function when it is posted to.

import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TraceType } from '@wdio/devtools-shared'
// eslint-disable-next-line no-restricted-imports -- builds a zip as an adapter does; app source never writes one
import { writeTraceZip } from '@wdio/devtools-trace/trace-exporter'

import {
  parseInWorker,
  readTraceArchive,
  type TraceParser
} from '../src/controller/trace-archive.js'
import { answerParseRequest } from '../src/controller/trace-parse.js'
import type {
  TraceOpenPhase,
  TraceParseMessage,
  TraceParseRequest
} from '../src/controller/trace-parse-protocol.js'

const dirs: string[] = []

afterEach(async () => {
  vi.unstubAllGlobals()
  await Promise.all(
    dirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true }))
  )
})

async function recordedTrace(): Promise<ArrayBuffer> {
  const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'trace-parse-'))
  dirs.push(outputDir)
  const zip = await writeTraceZip(
    {
      mutations: [],
      traceLogs: [],
      consoleLogs: [],
      networkRequests: [],
      commandsLog: [
        { command: 'url', args: ['https://example.com'], timestamp: 2000 }
      ],
      sources: new Map(),
      metadata: { type: TraceType.Testrunner, sessionId: 'abc12345' },
      startWallTime: 1000
    },
    { outputDir, sessionId: 'abc12345' }
  )
  return new Uint8Array(await fs.readFile(zip)).buffer
}

const junk = (): ArrayBuffer => new TextEncoder().encode('not a zip').buffer

function answers(bytes: ArrayBuffer): TraceParseMessage[] {
  const messages: TraceParseMessage[] = []
  answerParseRequest(bytes, (message) => messages.push(message))
  return messages
}

describe("the trace reader's side of the protocol", () => {
  it('reports each phase, then the payload', async () => {
    const messages = answers(await recordedTrace())

    expect(messages.slice(0, 2)).toEqual([
      { type: 'phase', phase: 'unpacking' },
      { type: 'phase', phase: 'building' }
    ])
    expect(messages).toHaveLength(3)
    const last = messages[2]!
    expect(last.type === 'done' && last.data.trace.commands[0]?.command).toBe(
      'url'
    )
  })

  it('answers bytes that are not a zip with the reason, not a throw', () => {
    const messages = answers(junk())

    expect(messages[0]).toEqual({ type: 'phase', phase: 'unpacking' })
    expect(messages).toHaveLength(2)
    expect(messages[1]).toMatchObject({ type: 'error' })
  })
})

interface Posted {
  url: string
  options?: WorkerOptions
  transfer: Transferable[]
  terminated: boolean
}

/** A Worker that runs the reader in this thread when posted to. */
function stubWorker(fail?: string): Posted[] {
  const workers: Posted[] = []
  class FakeWorker extends EventTarget {
    readonly #record: Posted

    constructor(url: URL, options?: WorkerOptions) {
      super()
      this.#record = {
        url: String(url),
        options,
        transfer: [],
        terminated: false
      }
      workers.push(this.#record)
    }

    postMessage(request: TraceParseRequest, transfer: Transferable[]) {
      this.#record.transfer = transfer
      queueMicrotask(() => {
        if (fail !== undefined) {
          this.dispatchEvent(new ErrorEvent('error', { message: fail }))
          return
        }
        answerParseRequest(request.bytes, (data) =>
          this.dispatchEvent(new MessageEvent('message', { data }))
        )
      })
    }

    terminate() {
      this.#record.terminated = true
    }
  }
  vi.stubGlobal('Worker', FakeWorker)
  return workers
}

describe("the page's side of the protocol", () => {
  it('loads the reader as a module worker from the app and hands it the bytes', async () => {
    const workers = stubWorker()
    const bytes = await recordedTrace()
    const phases: TraceOpenPhase[] = []

    const result = await parseInWorker(bytes, (phase) => phases.push(phase))

    expect(result.type).toBe('done')
    expect(phases).toEqual(['unpacking', 'building'])
    expect(workers).toHaveLength(1)
    expect(workers[0]!.url).toMatch(/\/trace-parse\.worker\.ts(\?|$)/)
    expect(workers[0]!.options).toEqual({ type: 'module' })
    expect(workers[0]!.transfer).toEqual([bytes])
    expect(workers[0]!.terminated).toBe(true)
  })

  it('passes a reason the bytes are not a trace through as a result', async () => {
    const workers = stubWorker()

    const result = await parseInWorker(junk(), () => {})

    expect(result.type).toBe('error')
    expect(workers[0]!.terminated).toBe(true)
  })

  it('rejects when the worker never starts', async () => {
    const workers = stubWorker('blocked')

    await expect(parseInWorker(junk(), () => {})).rejects.toThrow(
      'The trace reader could not start: blocked'
    )
    expect(workers[0]!.terminated).toBe(true)
  })
})

describe('readTraceArchive', () => {
  it('reports reading the file before the reader’s own phases', async () => {
    const phases: TraceOpenPhase[] = []

    const data = await readTraceArchive(
      new Blob([await recordedTrace()]),
      (phase) => phases.push(phase)
    )

    expect(phases).toEqual(['reading', 'unpacking', 'building'])
    expect(data.trace.metadata?.sessionId).toBe('abc12345')
  })

  it('names a reader error as an unreadable trace', async () => {
    const parse: TraceParser = () =>
      Promise.resolve({ type: 'error', message: 'invalid zip data' })

    await expect(
      readTraceArchive(new Blob(['zip']), () => {}, parse)
    ).rejects.toThrow('Not a readable trace: invalid zip data')
  })

  it('reports a reader that failed to run as it is', async () => {
    const parse: TraceParser = () =>
      Promise.reject(new Error('The trace reader could not start'))

    await expect(
      readTraceArchive(new Blob(['zip']), () => {}, parse)
    ).rejects.toThrow(/^The trace reader could not start$/)
  })

  it('hands the parser the file’s own bytes', async () => {
    const seen: number[] = []
    const parse: TraceParser = (bytes) => {
      seen.push(bytes.byteLength)
      return Promise.resolve({ type: 'error', message: 'stop' })
    }

    await expect(
      readTraceArchive(new Blob(['abc']), () => {}, parse)
    ).rejects.toThrow()
    expect(seen).toEqual([3])
  })
})
