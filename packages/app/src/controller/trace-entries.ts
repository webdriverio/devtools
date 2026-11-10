import { TRACE_ENTRY_CACHE_BYTES } from './constants.js'
import type { TraceArchiveClient } from './trace-archive.js'
import { BROWSER_BLOB_URLS, type BlobUrls } from '../utils/blob-urls.js'

interface Cached {
  blob: Blob
  url?: string
}

/** The shown trace's entries, read from its archive when first asked for and kept, least recently used dropped first, up to a byte cap; an entry a view has pinned is never dropped. */
export class TraceEntries {
  readonly #maxBytes: number
  readonly #urls: BlobUrls
  #archive?: TraceArchiveClient
  /** Bumped per trace, so a read that answers after the next trace opened is dropped. */
  #generation = 0
  /** Insertion order is recency: a hit is moved to the end. */
  #cache = new Map<string, Cached>()
  #bytes = 0
  #pending = new Map<string, Promise<Blob | undefined>>()
  /** What each view shows right now, by view; each pin replaces that view's last. */
  #pins = new Map<object, ReadonlySet<string>>()

  constructor(maxBytes = TRACE_ENTRY_CACHE_BYTES, urls = BROWSER_BLOB_URLS) {
    this.#maxBytes = maxBytes
    this.#urls = urls
  }

  /** The byte cap, which a view sizes what it draws by. */
  get maxBytes(): number {
    return this.#maxBytes
  }

  /** Drops `owner`'s pins, leaving its entries to the usual eviction. */
  unpin(owner: object): void {
    this.#pins.delete(owner)
  }

  /** Keeps `names` (and their URLs) for `owner` until its next pin, so what is on screen is never revoked under it. */
  pin(owner: object, names: Iterable<string>): void {
    this.#pins.set(owner, new Set(names))
  }

  /** Reads from `archive` from now on, closing the previous trace's archive and releasing its entries. */
  attach(archive?: TraceArchiveClient): void {
    this.#generation++
    this.#archive?.close()
    this.#archive = archive
    for (const { url } of this.#cache.values()) {
      if (url) {
        this.#urls.revoke(url)
      }
    }
    this.#cache.clear()
    this.#pending.clear()
    this.#pins.clear()
    this.#bytes = 0
  }

  /** One entry's bytes, read past the cache; for what the caller keeps itself. */
  async read(name: string): Promise<Blob | undefined> {
    const archive = this.#archive
    const generation = this.#generation
    if (!archive) {
      return undefined
    }
    try {
      const blob = await archive.read(name)
      return generation === this.#generation ? blob : undefined
    } catch (error) {
      if (generation === this.#generation) {
        console.warn(`Could not read ${name} from the trace`, error)
      }
      return undefined
    }
  }

  /** One entry's bytes, from the cache or read and cached. */
  blob(name: string): Promise<Blob | undefined> {
    const hit = this.#touch(name)
    if (hit) {
      return Promise.resolve(hit.blob)
    }
    const pending = this.#pending.get(name)
    if (pending) {
      return pending
    }
    const generation = this.#generation
    const read = this.read(name).then((blob) => {
      if (generation !== this.#generation) {
        return undefined
      }
      this.#pending.delete(name)
      if (blob) {
        this.#store(name, { blob })
      }
      return blob
    })
    this.#pending.set(name, read)
    return read
  }

  async text(name: string): Promise<string | undefined> {
    return (await this.blob(name))?.text()
  }

  /** An object URL for one entry, created once and revoked when it is dropped. */
  async url(name: string): Promise<string | undefined> {
    const generation = this.#generation
    const blob = await this.blob(name)
    if (!blob || generation !== this.#generation) {
      return undefined
    }
    // Dropped while the read was in flight: keep what was read rather than leave the view waiting forever.
    if (!this.#cache.has(name)) {
      this.#store(name, { blob })
    }
    return this.cachedUrl(name)
  }

  /** The URL of an entry already read, without reading it; undefined until `url` or `blob` has. */
  cachedUrl(name: string): string | undefined {
    const cached = this.#touch(name)
    if (!cached) {
      return undefined
    }
    cached.url ??= this.#urls.create(cached.blob)
    return cached.url
  }

  #pinned(name: string): boolean {
    return [...this.#pins.values()].some((names) => names.has(name))
  }

  #touch(name: string): Cached | undefined {
    const cached = this.#cache.get(name)
    if (cached) {
      this.#cache.delete(name)
      this.#cache.set(name, cached)
    }
    return cached
  }

  #store(name: string, entry: Cached): void {
    this.#cache.set(name, entry)
    this.#bytes += entry.blob.size
    // The entry just stored and every pinned one are kept, even past the cap.
    for (const [oldest, cached] of this.#cache) {
      if (this.#bytes <= this.#maxBytes) {
        break
      }
      if (oldest === name || this.#pinned(oldest)) {
        continue
      }
      this.#cache.delete(oldest)
      this.#bytes -= cached.blob.size
      if (cached.url) {
        this.#urls.revoke(cached.url)
      }
    }
  }
}
