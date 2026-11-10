import type { TracePlayerData } from '@wdio/devtools-shared'

import type { StoredPageResource } from '../components/browser/archived-resources.js'
import type { PlayerArchive } from './context.js'
import { readPageResources } from './page-resource-loader.js'
import type { TraceArchiveClient } from './trace-archive.js'
import { TraceEntries } from './trace-entries.js'

/** What a player trace needs before it is shown: its archive as the panels read it, and its stored page resources. */
export interface PreparedPlayerTrace {
  archive?: PlayerArchive
  resources: StoredPageResource[]
}

/** Switches the entry cache to each trace as it loads, closing the previous archive. */
export class PlayerTraceLoads {
  readonly #entries: TraceEntries
  /** Bumped per load, so a trace whose resources finish reading after a newer one began is dropped. */
  #generation = 0

  constructor(entries = new TraceEntries()) {
    this.#entries = entries
  }

  /** Undefined when a newer trace began loading meanwhile; the cache switches to `archive` only when this one is shown, so the trace on screen keeps reading its own. */
  async prepare(
    data: TracePlayerData,
    archive?: TraceArchiveClient
  ): Promise<PreparedPlayerTrace | undefined> {
    const generation = ++this.#generation
    const resources = archive
      ? await readPageResources(data.pageResources ?? [], (entry) =>
          archive.read(entry).catch((error: unknown) => {
            console.warn(`Could not read ${entry} from the trace`, error)
            return undefined
          })
        )
      : []
    if (generation !== this.#generation) {
      archive?.close()
      return undefined
    }
    this.#entries.attach(archive)
    return {
      resources,
      archive: archive && {
        entries: this.#entries,
        frameSize: data.frameSize,
        frameBytes: data.frameBytes,
        responseBodies: data.responseBodies ?? {}
      }
    }
  }
}
