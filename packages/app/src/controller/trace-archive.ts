import type { TracePlayerData } from '@wdio/devtools-shared'

import { HOSTED_PLAYER } from './constants.js'
import type {
  TraceOpenProgress,
  TraceReaderMessage,
  TraceReaderRequest
} from './trace-parse-protocol.js'

/** One opened trace zip: its payload, and its entries read on demand until it is closed. */
export interface TraceArchiveClient {
  /** Rejects with the reader's reason when the zip is not a trace. */
  open(blob: Blob, onPhase: TraceOpenProgress): Promise<TracePlayerData>
  read(name: string): Promise<Blob>
  /** Releases the zip; reads still in flight reject. */
  close(): void
}

export type TraceArchiveFactory = () => TraceArchiveClient

/** A loaded trace and the archive its images, bodies and page resources are still read from. */
export interface OpenedTrace {
  data: TracePlayerData
  archive: TraceArchiveClient
}

/** How the page reaches a reader: a worker, or the reader in this thread. */
interface TraceReaderChannel {
  send(request: TraceReaderRequest): void
  listen(onMessage: (message: TraceReaderMessage) => void): void
  /** Rejects whatever is waiting when the reader cannot run at all. */
  onFailure(fail: (error: Error) => void): void
  stop(): void
}

interface Pending<T> {
  resolve(value: T): void
  reject(error: Error): void
}

const closedError = (): Error => new Error('The trace was closed')

type Opening = Pending<TracePlayerData> & { onPhase: TraceOpenProgress }

/** The page's side of the protocol over any channel to a reader. */
class ChannelArchiveClient implements TraceArchiveClient {
  readonly #channel: TraceReaderChannel
  #opening?: Opening
  #reads = new Map<number, Pending<Blob>>()
  #nextId = 0
  #closed = false

  constructor(channel: TraceReaderChannel) {
    this.#channel = channel
    channel.onFailure((error) => {
      this.#closed = true
      this.#failAll(error)
    })
    channel.listen((message) => this.#receive(message))
  }

  open(blob: Blob, onPhase: TraceOpenProgress): Promise<TracePlayerData> {
    if (this.#closed) {
      return Promise.reject(closedError())
    }
    return new Promise((resolve, reject) => {
      this.#opening = { resolve, reject, onPhase }
      this.#channel.send({ type: 'open', blob })
    })
  }

  read(name: string): Promise<Blob> {
    if (this.#closed) {
      return Promise.reject(closedError())
    }
    const id = this.#nextId++
    return new Promise<Blob>((resolve, reject) => {
      this.#reads.set(id, { resolve, reject })
      this.#channel.send({ type: 'entry', id, name })
    })
  }

  close(): void {
    this.#closed = true
    this.#failAll(closedError())
    this.#channel.stop()
  }

  #receive(message: TraceReaderMessage): void {
    if (message.type === 'phase') {
      this.#opening?.onPhase(message.phase)
    } else if (message.type === 'done') {
      this.#opening?.resolve(message.data)
      this.#opening = undefined
    } else if (message.type === 'error') {
      this.#opening?.reject(
        new Error(`Not a readable trace: ${message.message}`)
      )
      this.#opening = undefined
    } else {
      const pending = this.#reads.get(message.id)
      this.#reads.delete(message.id)
      if (message.type === 'entry') {
        pending?.resolve(message.blob)
      } else {
        pending?.reject(new Error(message.message))
      }
    }
  }

  #failAll(error: Error): void {
    this.#opening?.reject(error)
    this.#opening = undefined
    this.#reads.forEach((pending) => pending.reject(error))
    this.#reads.clear()
  }
}

/** Reads off the main thread, so the tab stays responsive; the worker lives as long as the trace is shown. */
export const workerArchiveClient: TraceArchiveFactory = () => {
  const worker = new Worker(
    new URL('./trace-parse.worker.ts', import.meta.url),
    { type: 'module' }
  )
  return new ChannelArchiveClient({
    send: (request) => worker.postMessage(request),
    listen: (onMessage) =>
      worker.addEventListener('message', (event) => onMessage(event.data)),
    onFailure: (fail) => {
      worker.addEventListener('messageerror', () =>
        fail(new Error('The trace reader sent a reply this page cannot read'))
      )
      // The reader catches its own errors, so this is a worker that never started.
      worker.addEventListener('error', (event) =>
        fail(
          new Error(
            `The trace reader could not start${event.message ? `: ${event.message}` : ''}`
          )
        )
      )
    },
    stop: () => worker.terminate()
  })
}

/** The same reader in this thread, for a runtime with no Worker. */
export const inPageArchiveClient: TraceArchiveFactory = () => {
  let listener: ((message: TraceReaderMessage) => void) | undefined
  // Loaded on demand so the live dashboard never downloads the reader.
  const reader = import('./trace-parse.js').then(({ createTraceReader }) =>
    createTraceReader((message) => listener?.(message))
  )
  return new ChannelArchiveClient({
    send: (request) => void reader.then((answer) => answer(request)),
    listen: (onMessage) => {
      listener = onMessage
    },
    onFailure: (fail) =>
      void reader.catch((error: Error) =>
        fail(new Error(`The trace reader could not load: ${error.message}`))
      ),
    stop: () => {
      listener = undefined
    }
  })
}

// Gated on the build flag too, so the live dashboard's bundle never references the worker.
const defaultClient = (): TraceArchiveClient =>
  HOSTED_PLAYER && typeof Worker === 'function'
    ? workerArchiveClient()
    : inPageArchiveClient()

/** Opens a trace.zip entirely in this tab; the archive stays open for the caller to read from and close. */
export async function readTraceArchive(
  file: Blob,
  onPhase: TraceOpenProgress = () => {},
  createClient: TraceArchiveFactory = defaultClient
): Promise<OpenedTrace> {
  onPhase('reading')
  const archive = createClient()
  let data: TracePlayerData
  try {
    data = await archive.open(file, onPhase)
  } catch (error) {
    archive.close()
    throw error
  }
  const { commands, consoleLogs, networkRequests, mutations } = data.trace
  // A zip with no trace stream in it parses to a payload with nothing to show.
  if (
    !commands.length &&
    !data.frames.length &&
    !consoleLogs.length &&
    !networkRequests.length &&
    !mutations.length
  ) {
    archive.close()
    throw new Error('No trace found in this archive')
  }
  return { data, archive }
}
