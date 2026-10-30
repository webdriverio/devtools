import type { ReactiveController, ReactiveControllerHost } from 'lit'

import { TRACE_OPEN_EVENT } from './constants.js'
import type {
  TraceOpenPhase,
  TraceOpenProgress
} from './trace-parse-protocol.js'

type Host = ReactiveControllerHost & HTMLElement

/** The hosted player's open flow: a file picked in the UI or dropped anywhere. */
export class TraceOpenController implements ReactiveController {
  opening = false
  phase?: TraceOpenPhase
  error?: string

  readonly #host: Host
  readonly #load: (file: File, onPhase: TraceOpenProgress) => Promise<void>

  constructor(
    host: Host,
    load: (file: File, onPhase: TraceOpenProgress) => Promise<void>
  ) {
    this.#host = host
    this.#load = load
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

  async open(file: File) {
    if (this.opening) {
      return
    }
    this.opening = true
    this.error = undefined
    this.#host.requestUpdate()
    try {
      await this.#load(file, this.#onPhase)
    } catch (error) {
      this.error = `Could not open ${file.name}: ${(error as Error).message}`
    } finally {
      this.opening = false
      this.phase = undefined
      this.#host.requestUpdate()
    }
  }

  dismissError() {
    this.error = undefined
    this.#host.requestUpdate()
  }

  #onPhase = (phase: TraceOpenPhase): void => {
    this.phase = phase
    this.#host.requestUpdate()
  }

  #onAnnounced = (event: CustomEvent<File>): void => {
    void this.open(event.detail)
  }

  // Unhandled, a drop outside the landing screen navigates the tab to the zip.
  #onDragOver = (event: DragEvent): void => {
    event.preventDefault()
  }

  #onDrop = (event: DragEvent): void => {
    event.preventDefault()
    const file = event.dataTransfer?.files[0]
    if (file) {
      void this.open(file)
    }
  }
}
