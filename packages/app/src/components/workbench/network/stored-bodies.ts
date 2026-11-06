import type { NetworkRequest } from '@wdio/devtools-shared'

import type { PlayerArchive } from '../../../controller/context.js'

/** Response bodies a player trace stores beside its HAR, read from the zip when their request is opened; the host re-renders as each lands. */
export class StoredResponseBodies {
  readonly #onLoad: () => void
  #archive?: PlayerArchive
  #bodies = new Map<string, string>()
  #requested = new Set<string>()

  constructor(onLoad: () => void) {
    this.#onLoad = onLoad
  }

  /** `request` with its stored body once read; as it is, with a read started, until then. */
  withBody(
    request: NetworkRequest,
    archive: PlayerArchive | undefined
  ): NetworkRequest {
    if (archive !== this.#archive) {
      this.#archive = archive
      this.#bodies = new Map()
      this.#requested = new Set()
    }
    const entry = archive?.responseBodies[request.id]
    if (!archive || !entry || request.responseBody !== undefined) {
      return request
    }
    const body = this.#bodies.get(entry)
    if (body !== undefined) {
      return { ...request, responseBody: body }
    }
    if (!this.#requested.has(entry)) {
      this.#requested.add(entry)
      const bodies = this.#bodies
      void archive.entries.text(entry).then((text) => {
        if (text !== undefined && bodies === this.#bodies) {
          bodies.set(entry, text)
          this.#onLoad()
        }
      })
    }
    return request
  }
}
