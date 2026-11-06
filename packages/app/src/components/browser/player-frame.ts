import {
  imageBytesDimensions,
  nearestFrame,
  type CommandLog,
  type ImageSize,
  type TracePlayerFrame
} from '@wdio/devtools-shared'

import type { PlayerArchive } from '../../controller/context.js'

/** The frame a player row shows, read from the trace's zip as an object URL; the host re-renders when it changes. */
export class PlayerFrames {
  readonly #onChange: () => void
  #request = 0
  /** The shown row's frame URL; null when the trace has none for it. */
  current: string | null = null
  /** The shown frame's pixel size, which can differ from the first frame's after a rotation. */
  size: ImageSize | null = null

  constructor(onChange: () => void) {
    this.#onChange = onChange
  }

  /** Releases the shown frame to the cache, when the view leaves the page. */
  release(archive: PlayerArchive | undefined): void {
    archive?.entries.unpin(this)
  }

  /** Reads `command`'s frame, or clears it for no command; a read a later call superseded is dropped. */
  async show(
    frames: readonly TracePlayerFrame[],
    archive: PlayerArchive | undefined,
    command: CommandLog | undefined
  ): Promise<void> {
    const request = ++this.#request
    const entry = command && nearestFrame(frames, command.timestamp)?.entry
    archive?.entries.pin(this, entry ? [entry] : [])
    const blob =
      archive && entry ? await archive.entries.blob(entry) : undefined
    const src = (entry && (await archive?.entries.url(entry))) || null
    const size = blob ? await headerSize(blob) : null
    if (request === this.#request && src !== this.current) {
      this.current = src
      this.size = size
      this.#onChange()
    }
  }
}

/** Enough of an image to reach its size: a JPEG's EXIF can put the frame header well past the first kilobytes. */
const HEADER_BYTES = 1024 * 1024

async function headerSize(blob: Blob): Promise<ImageSize | null> {
  const header = await blob.slice(0, HEADER_BYTES).arrayBuffer()
  return imageBytesDimensions(new Uint8Array(header))
}
