import type { ReactiveController, ReactiveControllerHost } from 'lit'

import { TRACE_OPEN_EVENT } from './constants.js'
import { downloadTrace, traceUrlFrom } from './trace-download.js'
import type {
  TraceOpenPhase,
  TraceOpenProgress
} from './trace-parse-protocol.js'
import { traceParamFrom } from '../utils/trace-link.js'
import { sourcesFromDrop, type TraceSource } from '../utils/trace-sources.js'

type Host = ReactiveControllerHost & HTMLElement

/** What the app does with what was opened: one zip into the player, several into a list. */
export interface TraceOpenTargets {
  one: (bytes: Blob, onPhase: TraceOpenProgress) => Promise<void>
  many: (sources: readonly TraceSource[]) => void
}

const fileName = (path: string): string => path.split('/').pop() || path

/** The hosted player's open flow: files or folders picked in the UI or dropped anywhere, or a zip `?trace=` names. */
export class TraceOpenController implements ReactiveController {
  opening = false
  phase?: TraceOpenPhase
  error?: string

  readonly #host: Host
  readonly #targets: TraceOpenTargets
  readonly #onUserOpen: () => void

  /** `onUserOpen` runs as the viewer opens a trace by hand, never for the one `?trace=` names. */
  constructor(
    host: Host,
    targets: TraceOpenTargets,
    onUserOpen: () => void = () => {}
  ) {
    this.#host = host
    this.#targets = targets
    this.#onUserOpen = onUserOpen
    host.addController(this)
  }

  hostConnected() {
    this.#host.addEventListener(TRACE_OPEN_EVENT, this.#onAnnounced)
    window.addEventListener('dragover', this.#onDragOver)
    window.addEventListener('drop', this.#onDrop)
    const linked = traceParamFrom(window.location.search)
    if (linked !== null) {
      void this.openUrl(linked)
    }
  }

  hostDisconnected() {
    this.#host.removeEventListener(TRACE_OPEN_EVENT, this.#onAnnounced)
    window.removeEventListener('dragover', this.#onDragOver)
    window.removeEventListener('drop', this.#onDrop)
  }

  async open(sources: readonly TraceSource[]) {
    if (this.opening) {
      return
    }
    if (!sources.length) {
      this.error = 'No trace .zip found in what was opened'
      this.#host.requestUpdate()
      return
    }
    this.error = undefined
    if (sources.length > 1) {
      this.#targets.many(sources)
      this.#onUserOpen()
      this.#host.requestUpdate()
      return
    }
    await this.#openOne(sources[0], this.#onUserOpen)
  }

  /** Downloads and opens the zip at `raw`, resolved against `page`; only https or `page`'s own origin is fetched. */
  async openUrl(raw: string, page = new URL(window.location.href)) {
    if (this.opening) {
      return
    }
    let url: URL
    try {
      if (!raw.trim()) {
        throw new Error('The trace parameter is empty')
      }
      url = traceUrlFrom(raw, page)
    } catch (error) {
      this.error = `Could not open the trace URL: ${(error as Error).message}`
      this.#host.requestUpdate()
      return
    }
    this.error = undefined
    // Named by host and path alone: a signed URL's query is a credential, not a name.
    await this.#openOne({
      path: `${url.host}${url.pathname}`,
      read: () => {
        this.#onPhase('downloading')
        return downloadTrace(url, { page })
      }
    })
  }

  dismissError() {
    this.error = undefined
    this.#host.requestUpdate()
  }

  // `onLoaded` runs before the player renders the new trace, so nothing reads the address in between.
  async #openOne(source: TraceSource, onLoaded = () => {}) {
    this.opening = true
    this.#host.requestUpdate()
    try {
      await this.#targets.one(await source.read(), this.#onPhase)
      onLoaded()
    } catch (error) {
      this.error = `Could not open ${fileName(source.path)}: ${(error as Error).message}`
    } finally {
      this.opening = false
      this.phase = undefined
      this.#host.requestUpdate()
    }
  }

  #onPhase = (phase: TraceOpenPhase): void => {
    this.phase = phase
    this.#host.requestUpdate()
  }

  #onAnnounced = (event: CustomEvent<readonly TraceSource[]>): void => {
    void this.open(event.detail)
  }

  // Unhandled, a drop outside the landing screen navigates the tab to the zip.
  #onDragOver = (event: DragEvent): void => {
    event.preventDefault()
  }

  #onDrop = (event: DragEvent): void => {
    event.preventDefault()
    void this.openDrop(sourcesFromDrop(event.dataTransfer))
  }

  /** Opens what a drop held, once its folders have been walked. */
  async openDrop(collected: Promise<TraceSource[]>) {
    let sources: TraceSource[]
    try {
      sources = await collected
    } catch (error) {
      this.error = `Could not read what was dropped: ${(error as Error).message}`
      this.#host.requestUpdate()
      return
    }
    await this.open(sources)
  }
}
