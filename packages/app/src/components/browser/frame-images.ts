import type { PlayerArchive } from '../../controller/context.js'

/** Object URLs for a trace's frame images, read from its zip as they are first shown; the host re-renders as each one lands. */
export class FrameImages {
  readonly #onLoad: () => void
  #archive?: PlayerArchive
  #requested = new Set<string>()

  constructor(onLoad: () => void) {
    this.#onLoad = onLoad
  }

  /** Pins the frames this render draws, so the cache never drops one on screen to make room for another. */
  pin(archive: PlayerArchive | undefined, entries: Iterable<string>): void {
    archive?.entries.pin(this, entries)
  }

  /** Releases this strip's frames to the cache, when the strip leaves the page. */
  unpin(archive: PlayerArchive | undefined): void {
    archive?.entries.unpin(this)
  }

  /** The entry's URL once read; undefined, and a read started, until then. */
  src(archive: PlayerArchive | undefined, entry: string): string | undefined {
    if (archive !== this.#archive) {
      this.#archive = archive
      this.#requested = new Set()
    }
    if (!archive) {
      return undefined
    }
    const url = archive.entries.cachedUrl(entry)
    if (url) {
      return url
    }
    // Kept after a failed read too, so a frame the zip cannot give is not asked for on every playback tick.
    if (!this.#requested.has(entry)) {
      this.#requested.add(entry)
      const requested = this.#requested
      void archive.entries.url(entry).then((loaded) => {
        if (loaded && requested === this.#requested) {
          requested.delete(entry)
          this.#onLoad()
        }
      })
    }
    return undefined
  }
}
