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
  inPageArchiveClient,
  readTraceArchive,
  workerArchiveClient,
  type TraceArchiveClient
} from '../src/controller/trace-archive.js'
import { createTraceReader } from '../src/controller/trace-parse.js'
import type {
  TraceOpenPhase,
  TraceReaderMessage,
  TraceReaderRequest
} from '../src/controller/trace-parse-protocol.js'

const dirs: string[] = []
const SHOT = btoa('a frame')

afterEach(async () => {
  vi.unstubAllGlobals()
  await Promise.all(
    dirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true }))
  )
})

async function recordedTrace(): Promise<Blob> {
  const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'trace-parse-'))
  dirs.push(outputDir)
  const zip = await writeTraceZip(
    {
      mutations: [],
      traceLogs: [],
      consoleLogs: [],
      networkRequests: [],
      commandsLog: [
        {
          command: 'url',
          args: ['https://example.com'],
          timestamp: 2000,
          screenshot: SHOT
        }
      ],
      sources: new Map(),
      metadata: { type: TraceType.Testrunner, sessionId: 'abc12345' },
      startWallTime: 1000
    },
    { outputDir, sessionId: 'abc12345' }
  )
  return new Blob([new Uint8Array(await fs.readFile(zip))])
}

const junk = (): Blob => new Blob(['not a zip'])

async function answers(
  requests: TraceReaderRequest[]
): Promise<TraceReaderMessage[]> {
  const messages: TraceReaderMessage[] = []
  const answer = createTraceReader((message) => messages.push(message))
  for (const request of requests) {
    await answer(request)
  }
  return messages
}

describe("the trace reader's side of the protocol", () => {
  it('reports each phase, then the payload naming its frames by entry', async () => {
    const messages = await answers([
      { type: 'open', blob: await recordedTrace() }
    ])

    expect(messages.slice(0, 2)).toEqual([
      { type: 'phase', phase: 'unpacking' },
      { type: 'phase', phase: 'building' }
    ])
    expect(messages).toHaveLength(3)
    const last = messages[2]!
    expect(last.type === 'done' && last.data.trace.commands[0]?.command).toBe(
      'url'
    )
    expect(last.type === 'done' && last.data.frames[0]?.entry).toMatch(
      /^resources\//
    )
  })

  it('answers an entry of the open zip with its bytes', async () => {
    const blob = await recordedTrace()
    const opened = await answers([{ type: 'open', blob }])
    const done = opened[2]!
    const entry = done.type === 'done' ? done.data.frames[0]!.entry : ''

    const messages = await answers([
      { type: 'open', blob },
      { type: 'entry', id: 7, name: entry },
      { type: 'entry', id: 8, name: 'resources/missing' }
    ])

    const [read, missing] = messages.slice(3)
    expect(read).toMatchObject({ type: 'entry', id: 7 })
    expect(read!.type === 'entry' && (await read!.blob.text())).toBe('a frame')
    expect(missing).toMatchObject({ type: 'entry-error', id: 8 })
  })

  it('refuses an entry before any zip is open', async () => {
    expect(await answers([{ type: 'entry', id: 1, name: 'x' }])).toEqual([
      { type: 'entry-error', id: 1, message: 'No trace is open' }
    ])
  })

  it('answers bytes that are not a zip with the reason, not a throw', async () => {
    const messages = await answers([{ type: 'open', blob: junk() }])

    expect(messages[0]).toEqual({ type: 'phase', phase: 'unpacking' })
    expect(messages).toHaveLength(2)
    expect(messages[1]).toMatchObject({ type: 'error' })
  })
})

interface Posted {
  url: string
  options?: WorkerOptions
  requests: TraceReaderRequest[]
  terminated: boolean
}

/** A Worker that runs the reader in this thread when posted to. */
function stubWorker(fail?: string): Posted[] {
  const workers: Posted[] = []
  class FakeWorker extends EventTarget {
    readonly #record: Posted
    readonly #answer = createTraceReader((data) =>
      this.dispatchEvent(new MessageEvent('message', { data }))
    )

    constructor(url: URL, options?: WorkerOptions) {
      super()
      this.#record = {
        url: String(url),
        options,
        requests: [],
        terminated: false
      }
      workers.push(this.#record)
    }

    postMessage(request: TraceReaderRequest) {
      this.#record.requests.push(request)
      queueMicrotask(() => {
        if (fail !== undefined) {
          this.dispatchEvent(new ErrorEvent('error', { message: fail }))
          return
        }
        void this.#answer(request)
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
  it('loads the reader as a module worker, posts it the Blob and keeps it for reads', async () => {
    const workers = stubWorker()
    const blob = await recordedTrace()
    const phases: TraceOpenPhase[] = []
    const client = workerArchiveClient()

    const data = await client.open(blob, (phase) => phases.push(phase))
    const frame = await client.read(data.frames[0]!.entry)

    expect(phases).toEqual(['unpacking', 'building'])
    expect(await frame.text()).toBe('a frame')
    expect(workers).toHaveLength(1)
    expect(workers[0]!.url).toMatch(/\/trace-parse\.worker\.ts(\?|$)/)
    expect(workers[0]!.options).toEqual({ type: 'module' })
    expect(workers[0]!.requests[0]).toEqual({ type: 'open', blob })
    expect(workers[0]!.terminated).toBe(false)

    client.close()
    expect(workers[0]!.terminated).toBe(true)
  })

  it('rejects reads still in flight, and any after, once closed', async () => {
    stubWorker()
    const client = workerArchiveClient()
    const data = await client.open(await recordedTrace(), () => {})

    const inFlight = client.read(data.frames[0]!.entry)
    client.close()

    await expect(inFlight).rejects.toThrow('The trace was closed')
    await expect(client.read('x')).rejects.toThrow('The trace was closed')
  })

  it('passes a reason the bytes are not a trace through as a rejection', async () => {
    stubWorker()

    await expect(workerArchiveClient().open(junk(), () => {})).rejects.toThrow(
      /^Not a readable trace: /
    )
  })

  it('rejects when the worker never starts, and every read after', async () => {
    stubWorker('blocked')
    const client = workerArchiveClient()

    await expect(client.open(junk(), () => {})).rejects.toThrow(
      'The trace reader could not start: blocked'
    )
    await expect(client.read('resources/x')).rejects.toThrow(
      'The trace was closed'
    )
  })

  it('runs the same reader in the page without a worker', async () => {
    const client = inPageArchiveClient()
    const data = await client.open(await recordedTrace(), () => {})

    expect(await (await client.read(data.frames[0]!.entry)).text()).toBe(
      'a frame'
    )
    client.close()
  })
})

/** A client whose open answers as given, recording whether it was closed. */
function stubClient(open: TraceArchiveClient['open']) {
  const state = { closed: false }
  const client: TraceArchiveClient = {
    open,
    read: () => Promise.resolve(new Blob()),
    close: () => {
      state.closed = true
    }
  }
  return { state, create: () => client }
}

describe('readTraceArchive', () => {
  it('reports reading the file before the reader’s own phases, and leaves the archive open', async () => {
    const phases: TraceOpenPhase[] = []

    const { data, archive } = await readTraceArchive(
      await recordedTrace(),
      (phase) => phases.push(phase),
      inPageArchiveClient
    )

    expect(phases).toEqual(['reading', 'unpacking', 'building'])
    expect(data.trace.metadata?.sessionId).toBe('abc12345')
    expect(await (await archive.read(data.frames[0]!.entry)).text()).toBe(
      'a frame'
    )
    archive.close()
  })

  it('closes the archive and reports the reason when it is not a trace', async () => {
    const { state, create } = stubClient(() =>
      Promise.reject(new Error('Not a readable trace: invalid zip data'))
    )

    await expect(
      readTraceArchive(new Blob(['zip']), () => {}, create)
    ).rejects.toThrow('Not a readable trace: invalid zip data')
    expect(state.closed).toBe(true)
  })

  it('closes the archive of a zip with nothing to show', async () => {
    const { state, create } = stubClient(() =>
      Promise.resolve({
        trace: {
          commands: [],
          consoleLogs: [],
          networkRequests: [],
          mutations: []
        } as never,
        frames: [],
        startTime: 0,
        duration: 0
      })
    )

    await expect(
      readTraceArchive(new Blob(['zip']), () => {}, create)
    ).rejects.toThrow('No trace found in this archive')
    expect(state.closed).toBe(true)
  })

  it('hands the reader the file itself', async () => {
    const seen: Blob[] = []
    const file = new Blob(['abc'])
    const { create } = stubClient((blob) => {
      seen.push(blob)
      return Promise.reject(new Error('stop'))
    })

    await expect(readTraceArchive(file, () => {}, create)).rejects.toThrow()
    expect(seen).toEqual([file])
  })
})
