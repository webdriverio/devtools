import type { ReactiveController, ReactiveControllerHost } from 'lit'

import { TRACE_OPEN_EVENT } from './constants.js'
import type {
  TraceOpenPhase,
  TraceOpenProgress
} from './trace-parse-protocol.js'
import { sourcesFromDrop, type TraceSource } from '../utils/trace-sources.js'

type Host = ReactiveControllerHost & HTMLElement

/** What the app does with what was opened: one zip into the player, several into a list. */
export interface TraceOpenTargets {
  one: (bytes: Blob, onPhase: TraceOpenProgress) => Promise<void>
  many: (sources: readonly TraceSource[]) => void
}

const fileName = (path: string): string => path.split('/').pop() || path

/** The hosted player's open flow: files or folders picked in the UI or dropped anywhere. */
export class TraceOpenController implements ReactiveController {
  opening = false
  phase?: TraceOpenPhase
  error?: string

  readonly #host: Host
  readonly #targets: TraceOpenTargets

  constructor(host: Host, targets: TraceOpenTargets) {
    this.#host = host
    this.#targets = targets
    host.addController(this)
  }

  hostConnected() {
    this.#host.addEventListener(TRACE_OPEN_EVENT, this.#onAnnounced)
    window.addEventListener('dragover', this.#onDragOver)
    window.addEventListener('drop', this.#onDrop)
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
      this.#host.requestUpdate()
      return
    }
    await this.#openOne(sources[0])
  }

  dismissError() {
    this.error = undefined
    this.#host.requestUpdate()
  }

  async #openOne(source: TraceSource) {
    this.opening = true
    this.#host.requestUpdate()
    try {
      await this.#targets.one(await source.read(), this.#onPhase)
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
