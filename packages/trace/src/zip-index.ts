// Reads a zip's central directory and then single entries on demand, so a reader never holds every entry at once. Node-free: the hosted player runs it in a Web Worker.

import { inflateSync, strFromU8 } from 'fflate'

/** Random access to a zip's bytes: a Blob, a buffer, or anything else that can read a range. */
export interface ZipSource {
  size: number
  read(offset: number, length: number): Promise<Uint8Array>
}

interface ZipEntryInfo {
  method: number
  compressedSize: number
  size: number
  localHeaderOffset: number
}

/** A zip's entry names, and each entry's bytes read and inflated when asked for. */
export interface ZipIndex {
  names: ReadonlySet<string>
  read(name: string): Promise<Uint8Array>
  /** The inflated length the directory declares for an entry. */
  sizeOf(name: string): number | undefined
}

/** Most an entry may inflate to, and most a reader inflates at once; a trace's largest entries are a few megabytes. */
export const ZIP_MAX_INFLATED_BYTES = 512 * 1024 * 1024

const SIG = {
  eocd: 0x06054b50,
  zip64Locator: 0x07064b50,
  zip64Eocd: 0x06064b50,
  central: 0x02014b50,
  local: 0x04034b50
} as const

const EOCD_SIZE = 22
const MAX_COMMENT = 0xffff
const ZIP64_LOCATOR_SIZE = 20
const ZIP64_EOCD_SIZE = 56
const CENTRAL_HEADER_SIZE = 46
const LOCAL_HEADER_SIZE = 30
const ZIP64_EXTRA_ID = 0x0001
const UTF8_NAME_FLAG = 0x800
const METHOD_STORED = 0
const METHOD_DEFLATE = 8
const U16_MAX = 0xffff
const U32_MAX = 0xffffffff
/** Deflate's best ratio is about 1032:1, so a declared size past it is a lie. */
const DEFLATE_MAX_RATIO = 1032
const DEFLATE_SLACK_BYTES = 1024

const view = (bytes: Uint8Array): DataView =>
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)

function u64(data: DataView, at: number): number {
  return Number(data.getBigUint64(at, true))
}

const notAZip = (): Error => new Error('Not a zip archive')
const truncated = (): Error => new Error('The zip archive is truncated')

async function readExactly(
  source: ZipSource,
  offset: number,
  length: number
): Promise<Uint8Array> {
  if (offset < 0 || offset + length > source.size) {
    throw truncated()
  }
  const bytes = await source.read(offset, length)
  if (bytes.byteLength !== length) {
    throw truncated()
  }
  return bytes
}

/** The end record, searched for backwards because a comment of any length may follow it. */
async function findEocd(
  source: ZipSource
): Promise<{ at: number; record: DataView }> {
  const tailLength = Math.min(source.size, EOCD_SIZE + MAX_COMMENT)
  if (tailLength < EOCD_SIZE) {
    throw notAZip()
  }
  const tailStart = source.size - tailLength
  const tail = view(await readExactly(source, tailStart, tailLength))
  for (let at = tailLength - EOCD_SIZE; at >= 0; at--) {
    // The record's comment must run exactly to the end, or these four bytes are inside an entry.
    if (
      tail.getUint32(at, true) === SIG.eocd &&
      at + EOCD_SIZE + tail.getUint16(at + 20, true) === tailLength
    ) {
      return {
        at: tailStart + at,
        record: new DataView(tail.buffer, tail.byteOffset + at, EOCD_SIZE)
      }
    }
  }
  throw notAZip()
}

interface Directory {
  count: number
  offset: number
  size: number
}

/** The zip64 locator just before the end record, or undefined when the archive has none. */
async function zip64Locator(
  source: ZipSource,
  eocdAt: number
): Promise<DataView | undefined> {
  if (eocdAt < ZIP64_LOCATOR_SIZE) {
    return undefined
  }
  const locator = view(
    await readExactly(source, eocdAt - ZIP64_LOCATOR_SIZE, ZIP64_LOCATOR_SIZE)
  )
  return locator.getUint32(0, true) === SIG.zip64Locator ? locator : undefined
}

async function zip64Directory(
  source: ZipSource,
  locator: DataView
): Promise<Directory> {
  const record = view(
    await readExactly(source, u64(locator, 8), ZIP64_EOCD_SIZE)
  )
  if (record.getUint32(0, true) !== SIG.zip64Eocd) {
    throw truncated()
  }
  return {
    count: u64(record, 32),
    size: u64(record, 40),
    offset: u64(record, 48)
  }
}

async function readDirectory(source: ZipSource): Promise<Directory> {
  const { at, record } = await findEocd(source)
  const directory = {
    count: record.getUint16(10, true),
    size: record.getUint32(12, true),
    offset: record.getUint32(16, true)
  }
  // A zip64 archive saturates the 16/32-bit fields and keeps the real values in its own record; a plain zip may hold exactly 65535 entries.
  const saturated =
    directory.count === U16_MAX ||
    directory.size === U32_MAX ||
    directory.offset === U32_MAX
  const locator = saturated ? await zip64Locator(source, at) : undefined
  if (locator) {
    return zip64Directory(source, locator)
  }
  if (directory.size === U32_MAX || directory.offset === U32_MAX) {
    throw truncated()
  }
  return directory
}

/** The 64-bit values a zip64 extra field carries, in order, for the fields the header saturated. */
function applyZip64Extra(
  entry: ZipEntryInfo,
  extra: DataView,
  start: number,
  end: number
): void {
  let at = start
  while (at + 4 <= end) {
    const id = extra.getUint16(at, true)
    const length = extra.getUint16(at + 2, true)
    if (id === ZIP64_EXTRA_ID) {
      let field = at + 4
      for (const key of [
        'size',
        'compressedSize',
        'localHeaderOffset'
      ] as const) {
        if (entry[key] === U32_MAX && field + 8 <= at + 4 + length) {
          entry[key] = u64(extra, field)
          field += 8
        }
      }
      return
    }
    at += 4 + length
  }
}

function parseDirectory(
  bytes: Uint8Array,
  count: number
): Map<string, ZipEntryInfo> {
  const data = view(bytes)
  const entries = new Map<string, ZipEntryInfo>()
  let at = 0
  for (let i = 0; i < count; i++) {
    if (
      at + CENTRAL_HEADER_SIZE > bytes.byteLength ||
      data.getUint32(at, true) !== SIG.central
    ) {
      throw truncated()
    }
    const flags = data.getUint16(at + 8, true)
    const nameLength = data.getUint16(at + 28, true)
    const extraLength = data.getUint16(at + 30, true)
    const commentLength = data.getUint16(at + 32, true)
    const nameStart = at + CENTRAL_HEADER_SIZE
    const extraStart = nameStart + nameLength
    if (extraStart + extraLength + commentLength > bytes.byteLength) {
      throw truncated()
    }
    const entry: ZipEntryInfo = {
      method: data.getUint16(at + 10, true),
      compressedSize: data.getUint32(at + 20, true),
      size: data.getUint32(at + 24, true),
      localHeaderOffset: data.getUint32(at + 42, true)
    }
    applyZip64Extra(entry, data, extraStart, extraStart + extraLength)
    // Decoded as fflate's unzip decodes it, so a name reads the same through either.
    const name = strFromU8(
      bytes.subarray(nameStart, extraStart),
      !(flags & UTF8_NAME_FLAG)
    )
    if (!name.endsWith('/')) {
      entries.set(name, entry)
    }
    at = extraStart + extraLength + commentLength
  }
  return entries
}

/** Refuses an entry whose declared sizes no honest writer produces, before any of it is read. */
function checkSizes(name: string, entry: ZipEntryInfo): void {
  const ceiling =
    entry.method === METHOD_STORED
      ? entry.compressedSize
      : entry.compressedSize * DEFLATE_MAX_RATIO + DEFLATE_SLACK_BYTES
  if (entry.size > ZIP_MAX_INFLATED_BYTES) {
    throw new Error(`The zip entry ${name} is too large to read`)
  }
  if (entry.size > ceiling) {
    throw new Error(`The zip entry ${name} declares an impossible size`)
  }
}

function inflate(name: string, data: Uint8Array, size: number): Uint8Array {
  let out: Uint8Array
  try {
    // One byte of room, so an entry holding more than it declares shows as longer rather than cut to fit.
    out = inflateSync(data, { out: new Uint8Array(size + 1) })
  } catch (error) {
    throw new Error(`The zip entry ${name} is corrupt: ${String(error)}`)
  }
  if (out.byteLength !== size) {
    throw new Error(`The zip entry ${name} is not the size it declares`)
  }
  return out
}

async function readEntry(
  source: ZipSource,
  name: string,
  entry: ZipEntryInfo
): Promise<Uint8Array> {
  checkSizes(name, entry)
  // The local header's own extra field may differ in length from the directory's copy.
  const local = view(
    await readExactly(source, entry.localHeaderOffset, LOCAL_HEADER_SIZE)
  )
  if (local.getUint32(0, true) !== SIG.local) {
    throw new Error(`The zip entry ${name} has no local header`)
  }
  const dataStart =
    entry.localHeaderOffset +
    LOCAL_HEADER_SIZE +
    local.getUint16(26, true) +
    local.getUint16(28, true)
  const data = await readExactly(source, dataStart, entry.compressedSize)
  if (entry.method === METHOD_STORED) {
    if (data.byteLength !== entry.size) {
      throw new Error(`The zip entry ${name} is not the size it declares`)
    }
    return data
  }
  if (entry.method === METHOD_DEFLATE) {
    return inflate(name, data, entry.size)
  }
  throw new Error(
    `The zip entry ${name} uses unsupported compression (method ${entry.method})`
  )
}

/** Indexes a zip from its central directory; no entry is read until asked for. */
export async function openZip(source: ZipSource): Promise<ZipIndex> {
  const directory = await readDirectory(source)
  const entries = parseDirectory(
    await readExactly(source, directory.offset, directory.size),
    directory.count
  )
  return {
    names: new Set(entries.keys()),
    read: (name) => {
      const entry = entries.get(name)
      return entry
        ? readEntry(source, name, entry)
        : Promise.reject(new Error(`The trace has no entry ${name}`))
    },
    sizeOf: (name) => entries.get(name)?.size
  }
}

/** A zip already in memory. */
export function bytesZipSource(bytes: Uint8Array): ZipSource {
  return {
    size: bytes.byteLength,
    read: (offset, length) =>
      Promise.resolve(bytes.subarray(offset, offset + length))
  }
}

/** A zip in a Blob or File, read a range at a time. */
export function blobZipSource(blob: Blob): ZipSource {
  return {
    size: blob.size,
    read: async (offset, length) =>
      new Uint8Array(await blob.slice(offset, offset + length).arrayBuffer())
  }
}
