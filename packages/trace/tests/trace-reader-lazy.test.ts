import v8 from 'node:v8'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { TracePlayerData } from '@wdio/devtools-shared'

import {
  isEagerEntry,
  openTraceArchive,
  parseTraceZip,
  readTraceEntries,
  readTracePayload
} from '../src/trace-reader.js'
import {
  bytesZipSource,
  ZIP_MAX_INFLATED_BYTES,
  type ZipSource
} from '../src/zip-index.js'
import { syntheticTraceZip } from '../scripts/synthetic-trace.js'

const MAX_STRING = 64 * 1024

function longestString(value: unknown): number {
  if (typeof value === 'string') {
    return value.length
  }
  if (value && typeof value === 'object') {
    return Math.max(0, ...Object.values(value).map(longestString))
  }
  return 0
}

/** A source that counts the bytes it hands out. */
function countingSource(zip: Uint8Array): ZipSource & { bytesRead: number } {
  const inner = bytesZipSource(zip)
  const source = {
    size: inner.size,
    bytesRead: 0,
    read: (offset: number, length: number) => {
      source.bytesRead += length
      return inner.read(offset, length)
    }
  }
  return source
}

describe('reading a large trace', () => {
  let zip: Uint8Array
  let payload: TracePlayerData

  beforeAll(async () => {
    zip = new Uint8Array(await syntheticTraceZip())
    payload = await readTracePayload(
      await openTraceArchive(bytesZipSource(zip))
    )
  }, 60_000)

  it('is a trace of about 24 MB of frames', () => {
    expect(zip.byteLength).toBeGreaterThan(24_000_000)
    expect(payload.frames).toHaveLength(300)
    expect(payload.trace.commands).toHaveLength(30)
  })

  it('names every image by entry rather than carrying it', () => {
    expect(longestString(payload)).toBeLessThan(MAX_STRING)
    expect(v8.serialize(payload).byteLength).toBeLessThan(zip.byteLength * 0.02)
  })

  it('reads the first frame only for its size', () => {
    expect(payload.frameSize).toEqual({ width: 1280, height: 720 })
  })

  it('opens a trace whose first frame cannot be read, without its size', async () => {
    const archive = await openTraceArchive(bytesZipSource(zip))
    const read = archive.read
    archive.read = (name) =>
      name === payload.frames[0]!.entry
        ? Promise.reject(new Error('corrupt'))
        : read(name)

    const opened = await readTracePayload(archive)

    expect(opened.frames).toHaveLength(300)
    expect(opened.frameSize).toBeUndefined()
  })

  it('reads only the entries the payload is built from', async () => {
    const source = countingSource(zip)
    const archive = await openTraceArchive(source)
    const requested: string[] = []
    const read = archive.read
    archive.read = (name) => {
      requested.push(name)
      return read(name)
    }

    await readTraceEntries(archive)
    expect(requested.length).toBeGreaterThan(0)
    expect(requested.every(isEagerEntry)).toBe(true)
    const eagerBytes = source.bytesRead

    await readTracePayload(archive)
    const lazy = requested.filter((name) => !isEagerEntry(name))
    expect(lazy).toEqual([payload.frames[0]!.entry])
    expect(eagerBytes).toBeLessThan(zip.byteLength * 0.01)
  })

  it('refuses a zip whose payload entries declare more than the reader inflates at once', async () => {
    const read = vi.fn(() => Promise.resolve(new Uint8Array()))
    const archive = {
      names: new Set(['a.trace', 'b.trace']),
      read,
      sizeOf: () => ZIP_MAX_INFLATED_BYTES / 2 + 1
    }

    await expect(readTraceEntries(archive)).rejects.toThrow(
      'declares more data than the player reads'
    )
    expect(read).not.toHaveBeenCalled()
  })

  it('budgets frames by the largest one, not the first', async () => {
    const small = new Uint8Array(
      await syntheticTraceZip({ frames: 3, frameBytes: 1024 })
    )
    const archive = await openTraceArchive(bytesZipSource(small))
    const sizes = new Map([
      [(await readTracePayload(archive)).frames[2]!.entry, 5_000_000]
    ])
    const sizeOf = archive.sizeOf
    archive.sizeOf = (name) => sizes.get(name) ?? sizeOf(name)

    expect((await readTracePayload(archive)).frameBytes).toBe(5_000_000)
    expect(parseTraceZip(small).frameBytes).toBe(1024)
  })
})
