import type { ReactiveControllerHost } from 'lit'

import { readTraceArchive, type OpenedTrace } from './trace-archive.js'
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
  | { status: 'ready'; summary: TraceSummary }
  | { status: 'error'; error: string }
)

/** Opens one zip; the caller closes the archive it returns or hands it on. */
export type TraceRunOpener = (bytes: Blob) => Promise<OpenedTrace>

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

const reason = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

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

/** Traces opened together, read in turn (one zip open at a time) for their summary alone, and opened again when their row is picked. */
export class TraceRunController {
  entries: TraceRunEntry[] = []
  selectedId?: number
  /** Why the last pick could not be opened, for the same banner a failed open shows. */
  error?: string

  readonly #host: ReactiveControllerHost
  readonly #show: (opened: OpenedTrace) => void | Promise<void>
  readonly #open: TraceRunOpener
  #sources: readonly TraceSource[] = []
  #generation = 0
  #selection = 0

  constructor(
    host: ReactiveControllerHost,
    show: (opened: OpenedTrace) => void | Promise<void>,
    open: TraceRunOpener = (bytes) => readTraceArchive(bytes)
  ) {
    this.#host = host
    this.#show = show
    this.#open = open
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
    const selection = ++this.#selection
    this.selectedId = undefined
    this.#sources = sources
    this.entries = sources.map((source, id) => ({
      ...this.#base(id, source),
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
    await this.#selectFirst(selection)
  }

  /** Opens the row's zip again and shows it, unless another row was picked meanwhile. */
  async select(id: number): Promise<void> {
    const entry = this.entries.find((candidate) => candidate.id === id)
    const source = this.#sources[id]
    if (entry?.status !== 'ready' || !source) {
      return
    }
    const selection = ++this.#selection
    let opened: OpenedTrace
    try {
      opened = await this.#open(await source.read())
    } catch (error) {
      // It read once, so the row stays pickable: a failure here can be passing (a file moved back, a backend restarted).
      if (selection === this.#selection) {
        this.error = `Could not open ${source.path}: ${reason(error)}`
        this.#host.requestUpdate()
      }
      return
    }
    if (selection !== this.#selection) {
      opened.archive.close()
      return
    }
    await this.#show(opened)
    if (selection === this.#selection) {
      this.selectedId = id
      this.error = undefined
      this.#host.requestUpdate()
    }
  }

  dismissError(): void {
    this.error = undefined
    this.#host.requestUpdate()
  }

  /** Drops any pick still opening, so it cannot replace a trace opened some other way meanwhile. */
  cancelPending(): void {
    this.#selection++
  }

  clear(): void {
    this.#generation++
    this.#selection++
    this.#sources = []
    this.error = undefined
    this.entries = []
    this.selectedId = undefined
    this.#host.requestUpdate()
  }

  #base(id: number, source: TraceSource) {
    return { id, path: source.path, label: traceLabelFromPath(source.path) }
  }

  // One zip's failure is its own row; it never stops the rest of the run.
  async #read(id: number, source: TraceSource): Promise<TraceRunEntry> {
    const base = this.#base(id, source)
    try {
      const { data, archive } = await this.#open(await source.read())
      archive.close()
      return { ...base, status: 'ready', summary: summarizeTrace(data) }
    } catch (error) {
      return { ...base, status: 'error', error: reason(error) }
    }
  }

  #replace(entry: TraceRunEntry): void {
    this.entries = this.entries.map((current) =>
      current.id === entry.id ? entry : current
    )
    this.#host.requestUpdate()
  }

  // Opens the top of the list once it is known, unless a row was picked meanwhile.
  async #selectFirst(selectionAtOpen: number): Promise<void> {
    if (this.#selection !== selectionAtOpen) {
      return
    }
    const first = this.ordered.find((entry) => entry.status === 'ready')
    if (first) {
      await this.select(first.id)
    }
  }
}
