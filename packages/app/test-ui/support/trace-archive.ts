// A trace zip and a loaded player archive built in the browser, so player specs
// go through the real reader and entry cache rather than a payload carrying images.

import type { PlayerArchive } from '@/controller/context.js'
import type { TraceArchiveClient } from '@/controller/trace-archive.js'
import { TraceEntries } from '@/controller/trace-entries.js'

const encoder = new TextEncoder()

const u16 = (value: number) => [value & 0xff, (value >>> 8) & 0xff]
const u32 = (value: number) => [...u16(value & 0xffff), ...u16(value >>> 16)]

/** A zip of uncompressed entries; the reader checks no checksum, so none is written. */
export function storedZip(files: Record<string, string | Uint8Array>): Blob {
  const out: number[] = []
  const central: number[] = []
  for (const [path, content] of Object.entries(files)) {
    const name = [...encoder.encode(path)]
    const data = typeof content === 'string' ? encoder.encode(content) : content
    const offset = out.length
    const header = [...u16(20), ...u16(0x800), ...u16(0), ...u32(0), ...u32(0)]
    const sizes = [
      ...u32(data.length),
      ...u32(data.length),
      ...u16(name.length),
      ...u16(0)
    ]
    out.push(...u32(0x04034b50), ...header, ...sizes, ...name, ...data)
    central.push(
      ...u32(0x02014b50),
      ...u16(20),
      ...header,
      ...sizes,
      ...u16(0),
      ...u16(0),
      ...u16(0),
      ...u32(0),
      ...u32(offset),
      ...name
    )
  }
  const count = Object.keys(files).length
  const cdOffset = out.length
  out.push(...central)
  out.push(
    ...u32(0x06054b50),
    ...u16(0),
    ...u16(0),
    ...u16(count),
    ...u16(count),
    ...u32(central.length),
    ...u32(cdOffset),
    ...u16(0)
  )
  return new Blob([new Uint8Array(out)], { type: 'application/zip' })
}

const toBytes = (base64: string): Uint8Array<ArrayBuffer> =>
  Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))

/** A loaded trace whose frame entries hold the given base64 images. */
export function playerArchive(
  images: Record<string, string>,
  frameSize?: PlayerArchive['frameSize'],
  frameBytes?: number,
  maxBytes?: number
): PlayerArchive {
  const client: TraceArchiveClient = {
    open: () => Promise.reject(new Error('already open')),
    read: (name) =>
      name in images
        ? Promise.resolve(new Blob([toBytes(images[name]!)]))
        : Promise.reject(new Error(`no entry ${name}`)),
    close: () => {}
  }
  const entries = new TraceEntries(maxBytes)
  entries.attach(client)
  return { entries, frameSize, frameBytes, responseBodies: {} }
}
