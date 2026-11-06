import { deflateSync, strFromU8, strToU8, zipSync } from 'fflate'
import { describe, expect, it, vi } from 'vitest'

import {
  blobZipSource,
  bytesZipSource,
  openZip,
  ZIP_MAX_INFLATED_BYTES,
  type ZipSource
} from '../src/zip-index.js'

interface Entry {
  name: string
  text: string
  method?: number
  /** Sizes and CRC follow the data instead of the local header (flag bit 3). */
  descriptor?: boolean
  /** Saturates the 32-bit fields and carries the real values in a zip64 extra field. */
  zip64?: boolean
  localExtra?: number[]
  /** The inflated size the headers claim, when it is to differ from the real one. */
  declaredSize?: number
}

const u16 = (value: number) => [value & 0xff, (value >>> 8) & 0xff]
const u32 = (value: number) => [...u16(value & 0xffff), ...u16(value >>> 16)]
const u64 = (value: number) => [...u32(value % 2 ** 32), ...u32(0)]
const SATURATED = 0xffffffff

/** A hand-written archive, for the layouts the writers in this repo never produce. */
function buildZip(
  entries: Entry[],
  { zip64 = false, comment = [] as number[] } = {}
): Uint8Array<ArrayBuffer> {
  const out: number[] = []
  const central: number[] = []
  for (const entry of entries) {
    const raw = strToU8(entry.text)
    const method = entry.method ?? 8
    const data = method === 8 ? deflateSync(raw) : raw
    const name = [...strToU8(entry.name)]
    const flags = 0x800 | (entry.descriptor ? 0x8 : 0)
    const offset = out.length
    const localExtra = entry.localExtra ?? []
    const declared = entry.declaredSize ?? raw.length
    out.push(
      ...u32(0x04034b50),
      ...u16(20),
      ...u16(flags),
      ...u16(method),
      ...u32(0),
      ...u32(0),
      ...u32(entry.descriptor ? 0 : data.length),
      ...u32(entry.descriptor ? 0 : declared),
      ...u16(name.length),
      ...u16(localExtra.length),
      ...name,
      ...localExtra,
      ...data
    )
    if (entry.descriptor) {
      out.push(
        ...u32(0x08074b50),
        ...u32(0),
        ...u32(data.length),
        ...u32(raw.length)
      )
    }
    const extra = entry.zip64
      ? [
          ...u16(1),
          ...u16(24),
          ...u64(raw.length),
          ...u64(data.length),
          ...u64(offset)
        ]
      : []
    central.push(
      ...u32(0x02014b50),
      ...u16(20),
      ...u16(20),
      ...u16(flags),
      ...u16(method),
      ...u32(0),
      ...u32(0),
      ...u32(entry.zip64 ? SATURATED : data.length),
      ...u32(entry.zip64 ? SATURATED : declared),
      ...u16(name.length),
      ...u16(extra.length),
      ...u16(0),
      ...u16(0),
      ...u16(0),
      ...u32(0),
      ...u32(entry.zip64 ? SATURATED : offset),
      ...name,
      ...extra
    )
  }
  const cdOffset = out.length
  central.forEach((byte) => out.push(byte))
  if (zip64) {
    const recordOffset = out.length
    out.push(
      ...u32(0x06064b50),
      ...u64(44),
      ...u16(45),
      ...u16(45),
      ...u32(0),
      ...u32(0),
      ...u64(entries.length),
      ...u64(entries.length),
      ...u64(central.length),
      ...u64(cdOffset),
      ...u32(0x07064b50),
      ...u32(0),
      ...u64(recordOffset),
      ...u32(1)
    )
  }
  out.push(
    ...u32(0x06054b50),
    ...u16(0),
    ...u16(0),
    ...u16(zip64 ? 0xffff : entries.length),
    ...u16(zip64 ? 0xffff : entries.length),
    ...u32(zip64 ? SATURATED : central.length),
    ...u32(zip64 ? SATURATED : cdOffset),
    ...u16(comment.length),
    ...comment
  )
  return new Uint8Array(out)
}

async function readAll(zip: Uint8Array): Promise<Record<string, string>> {
  const index = await openZip(bytesZipSource(zip))
  const out: Record<string, string> = {}
  for (const name of index.names) {
    out[name] = strFromU8(await index.read(name))
  }
  return out
}

describe('openZip', () => {
  it('reads stored and deflated entries', async () => {
    const zip = buildZip([
      { name: 'a.txt', text: 'stored', method: 0 },
      { name: 'b/c.txt', text: 'deflated '.repeat(50) }
    ])
    expect(await readAll(zip)).toEqual({
      'a.txt': 'stored',
      'b/c.txt': 'deflated '.repeat(50)
    })
  })

  it('reads what fflate writes, at either level, past a trailing comment', async () => {
    const files = {
      'x.trace': strToU8('{"a":1}'),
      'resources/y': strToU8('yy')
    }
    for (const level of [0, 6] as const) {
      const zip = zipSync(files, { level, comment: 'trace written by a test' })
      expect(await readAll(zip)).toEqual({
        'x.trace': '{"a":1}',
        'resources/y': 'yy'
      })
    }
  })

  it('takes sizes from the directory for an entry written with a data descriptor', async () => {
    const zip = buildZip([
      { name: 'streamed', text: 'after the data', descriptor: true },
      { name: 'next', text: 'still found', method: 0 }
    ])
    expect(await readAll(zip)).toEqual({
      streamed: 'after the data',
      next: 'still found'
    })
  })

  it('skips a local extra field the directory does not repeat', async () => {
    const zip = buildZip([
      {
        name: 'padded',
        text: 'aligned',
        method: 0,
        localExtra: [0xfe, 0xca, 2, 0, 0, 0]
      }
    ])
    expect(await readAll(zip)).toEqual({ padded: 'aligned' })
  })

  it('reads a zip64 archive and zip64 entries', async () => {
    const zip = buildZip(
      [
        { name: 'big', text: 'sixty-four', zip64: true },
        { name: 'small', text: 'plain', method: 0 }
      ],
      { zip64: true }
    )
    expect(await readAll(zip)).toEqual({ big: 'sixty-four', small: 'plain' })
  })

  it('refuses bytes that are not a zip', async () => {
    await expect(
      openZip(bytesZipSource(strToU8('not a zip at all, just text')))
    ).rejects.toThrow('Not a zip archive')
    await expect(openZip(bytesZipSource(new Uint8Array(3)))).rejects.toThrow(
      'Not a zip archive'
    )
  })

  it('refuses a truncated archive', async () => {
    const zip = buildZip([{ name: 'a', text: 'abc'.repeat(100) }])
    // Cut from the front, so the end record survives but points past the start.
    await expect(openZip(bytesZipSource(zip.subarray(40)))).rejects.toThrow(
      'truncated'
    )
    const index = await openZip(bytesZipSource(zip))
    const short: ZipSource = {
      size: zip.byteLength,
      read: (offset, length) =>
        Promise.resolve(zip.subarray(offset, offset + length - 1))
    }
    await expect(openZip(short)).rejects.toThrow('truncated')
    expect(index.names).toEqual(new Set(['a']))
  })

  it('refuses an entry in a compression it cannot inflate', async () => {
    const index = await openZip(
      bytesZipSource(buildZip([{ name: 'bz', text: 'xx', method: 12 }]))
    )
    await expect(index.read('bz')).rejects.toThrow('unsupported compression')
  })

  it('refuses a name the archive does not hold', async () => {
    const index = await openZip(
      bytesZipSource(buildZip([{ name: 'a', text: 'a' }]))
    )
    await expect(index.read('b')).rejects.toThrow('no entry b')
  })

  it('reads a Blob a range at a time, never whole', async () => {
    const zip = buildZip([
      { name: 'one', text: 'first', method: 0 },
      { name: 'two', text: 'x'.repeat(80_000), method: 0 }
    ])
    const blob = new Blob([zip])
    const slice = vi.spyOn(blob, 'slice')
    const index = await openZip(blobZipSource(blob))
    expect(strFromU8(await index.read('one'))).toBe('first')
    expect(
      slice.mock.calls.every(
        ([start, end]) => (end ?? 0) - (start ?? 0) < zip.byteLength
      )
    ).toBe(true)
  })
})

describe('openZip on a hostile archive', () => {
  it('refuses an entry claiming more than deflate can expand to, before inflating it', async () => {
    const index = await openZip(
      bytesZipSource(
        buildZip([{ name: 'bomb', text: 'a', declaredSize: 10_000_000 }])
      )
    )
    await expect(index.read('bomb')).rejects.toThrow('impossible size')
  })

  it('refuses an entry declared past the inflate cap', async () => {
    const index = await openZip(
      bytesZipSource(
        buildZip([
          { name: 'huge', text: 'a', declaredSize: ZIP_MAX_INFLATED_BYTES + 1 }
        ])
      )
    )
    await expect(index.read('huge')).rejects.toThrow('too large')
  })

  it('refuses an entry whose bytes are not the size it declares', async () => {
    const index = await openZip(
      bytesZipSource(
        buildZip([
          { name: 'short', text: 'abc', declaredSize: 5 },
          { name: 'long', text: 'abcdef', declaredSize: 2 },
          { name: 'stored', text: 'abc', method: 0, declaredSize: 2 }
        ])
      )
    )
    await expect(index.read('long')).rejects.toThrow('not the size it declares')
    await expect(index.read('short')).rejects.toThrow(
      'not the size it declares'
    )
    await expect(index.read('stored')).rejects.toThrow(
      'not the size it declares'
    )
  })

  it('skips an end record signature that sits inside the comment', async () => {
    const fake = [
      ...u32(0x06054b50),
      ...u16(0),
      ...u16(0),
      ...u16(1),
      ...u16(1),
      ...u32(46),
      ...u32(0),
      ...u16(0)
    ]
    const zip = buildZip([{ name: 'real', text: 'kept', method: 0 }], {
      comment: [...fake, 1, 2, 3]
    })
    expect(await readAll(zip)).toEqual({ real: 'kept' })
  })

  it('reads a plain zip of exactly 65535 entries without taking it for zip64', async () => {
    const entries = Array.from({ length: 0xffff }, (_, i) => ({
      name: `e${i}`,
      text: '',
      method: 0
    }))
    const index = await openZip(bytesZipSource(buildZip(entries)))
    expect(index.names.size).toBe(0xffff)
  }, 60_000)

  it('refuses a directory whose name runs past its end with its own error', async () => {
    const zip = buildZip([{ name: 'a', text: 'a', method: 0 }])
    const central = zip.findIndex(
      (_, i) =>
        zip[i] === 0x50 &&
        zip[i + 1] === 0x4b &&
        zip[i + 2] === 1 &&
        zip[i + 3] === 2
    )
    zip[central + 28] = 0xff
    zip[central + 29] = 0xff
    await expect(openZip(bytesZipSource(zip))).rejects.toThrow('truncated')
  })
})
