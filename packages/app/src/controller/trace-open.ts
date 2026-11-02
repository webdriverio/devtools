import type { ReactiveController, ReactiveControllerHost } from 'lit'

import { TRACE_OPEN_EVENT } from './constants.js'

type Host = ReactiveControllerHost & HTMLElement

/** The hosted player's open flow: a file picked in the UI or dropped anywhere. */
export class TraceOpenController implements ReactiveController {
  opening = false
  error?: string

  readonly #host: Host
  readonly #load: (file: File) => Promise<void>

  constructor(host: Host, load: (file: File) => Promise<void>) {
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
    // Lets "Opening trace…" paint before the synchronous unzip holds the thread.
    await new Promise((resolve) =>
      requestAnimationFrame(() => setTimeout(resolve))
    )
    try {
      await this.#load(file)
    } catch (error) {
      this.error = `Could not open ${file.name}: ${(error as Error).message}`
    } finally {
      this.opening = false
      this.#host.requestUpdate()
    }
  }

  dismissError() {
    this.error = undefined
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
