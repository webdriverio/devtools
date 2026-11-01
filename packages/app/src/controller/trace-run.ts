import type { ReactiveControllerHost } from 'lit'
import type { TracePlayerData } from '@wdio/devtools-shared'

import { readTraceArchive } from './trace-archive.js'
import type { TraceSource } from '../utils/trace-sources.js'
import {
  summarizeTrace,
  traceLabelFromPath,
  TRACE_OUTCOME,
  type TraceSummary
} from '../utils/trace-summary.js'

/** One zip of an opened run: still to read, read, or refused by the reader. */
export type TraceRunEntry = {
  /** Position among the zips as they were found. */
  id: number
  path: string
  /** From the path; the list prefers the test's own name once the zip is read. */
  label: string
} & (
  | { status: 'pending' }
  | { status: 'ready'; summary: TraceSummary; data: TracePlayerData }
  | { status: 'error'; error: string }
)

/** Reads one zip into the player payload. */
export type TraceRunParser = (bytes: Blob) => Promise<TracePlayerData>

// Failures first, since a run is opened to find what broke; then unreadable zips, which may be failures too.
const RANK = {
  [TRACE_OUTCOME.FAILED]: 0,
  error: 1,
  [TRACE_OUTCOME.UNKNOWN]: 2,
  [TRACE_OUTCOME.PASSED]: 3,
  pending: 4
} as const

const rankOf = (entry: TraceRunEntry): number =>
  entry.status === 'ready' ? RANK[entry.summary.outcome] : RANK[entry.status]

const startOf = (entry: TraceRunEntry): number =>
  entry.status === 'ready' ? entry.summary.startTime : Number.POSITIVE_INFINITY

/** Failed first, then unreadable, unknown and passed; in run order within each. */
export function orderTraceRun(
  entries: readonly TraceRunEntry[]
): TraceRunEntry[] {
  return [...entries].sort(
    (a, b) => rankOf(a) - rankOf(b) || startOf(a) - startOf(b) || a.id - b.id
  )
}

/** Traces opened together, read once each and in turn (one zip's bytes in flight), kept for when their row is picked. */
export class TraceRunController {
  entries: TraceRunEntry[] = []
  selectedId?: number

  readonly #host: ReactiveControllerHost
  readonly #show: (data: TracePlayerData) => void
  readonly #parse: TraceRunParser
  #generation = 0

  constructor(
    host: ReactiveControllerHost,
    show: (data: TracePlayerData) => void,
    parse: TraceRunParser = (bytes) => readTraceArchive(bytes)
  ) {
    this.#host = host
    this.#show = show
    this.#parse = parse
  }

  get active(): boolean {
    return this.entries.length > 0
  }

  get loading(): boolean {
    return this.entries.some((entry) => entry.status === 'pending')
  }

  /** As found while reading, so rows do not move under the pointer; sorted once all are read. */
  get ordered(): TraceRunEntry[] {
    return this.loading ? this.entries : orderTraceRun(this.entries)
  }

  async open(sources: readonly TraceSource[]): Promise<void> {
    const generation = ++this.#generation
    this.selectedId = undefined
    this.entries = sources.map((source, id) => ({
      id,
      path: source.path,
      label: traceLabelFromPath(source.path),
      status: 'pending'
    }))
    this.#host.requestUpdate()
    for (const [id, source] of sources.entries()) {
      const settled = await this.#read(id, source)
      if (generation !== this.#generation) {
        return
      }
      this.#replace(settled)
    }
    this.#selectFirst()
  }

  select(id: number): void {
    const entry = this.entries.find((candidate) => candidate.id === id)
    if (entry?.status !== 'ready') {
      return
    }
    this.selectedId = id
    this.#show(entry.data)
    this.#host.requestUpdate()
  }

  clear(): void {
    this.#generation++
    this.entries = []
    this.selectedId = undefined
    this.#host.requestUpdate()
  }

  // One zip's failure is its own row; it never stops the rest of the run.
  async #read(id: number, source: TraceSource): Promise<TraceRunEntry> {
    const base = {
      id,
      path: source.path,
      label: traceLabelFromPath(source.path)
    }
    try {
      const data = await this.#parse(await source.read())
      return { ...base, status: 'ready', data, summary: summarizeTrace(data) }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { ...base, status: 'error', error: message }
    }
  }

  #replace(entry: TraceRunEntry): void {
    this.entries = this.entries.map((current) =>
      current.id === entry.id ? entry : current
    )
    this.#host.requestUpdate()
  }

  // Opens the top of the list once it is known, unless a row was picked meanwhile.
  #selectFirst(): void {
    if (this.selectedId !== undefined) {
      return
    }
    const first = this.ordered.find((entry) => entry.status === 'ready')
    if (first) {
      this.select(first.id)
    }
  }
}
