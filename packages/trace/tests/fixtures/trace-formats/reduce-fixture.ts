// Makes a reader fixture from a real trace zip: images become 1x1 marked images of the same format, all else keeps its bytes.

import { writeFileSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { crc32 } from 'node:zlib'
import { strFromU8, unzipSync } from 'fflate'
import yazl from 'yazl'

import type { TraceFormatManifest } from './fixture-manifest.js'

type Entries = Record<string, Uint8Array>
type TraceEvent = Record<string, unknown> & { type?: string }

// 1x1 baseline greyscale JPEG with one Huffman code per table, which ImageIO decodes.
const TINY_JPEG = Buffer.from(
  '/9j/2wBDAAEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAAAP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AP//Z',
  'base64'
)
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
)
const PNG_SIGNATURE_LENGTH = 8
const PNG_IHDR_CHUNK_LENGTH = 25
const MARKER_KEYWORD = 'Comment'
const DATA_IMAGE_URI = /(data:image\/(?:png|jpeg);base64,)([A-Za-z0-9+/=]+)/g
// Fixed so reducing the same source twice yields the same bytes.
const ENTRY_MTIME = new Date('2026-01-01T00:00:00Z')

type ImageFormat = 'jpeg' | 'png'

function imageFormat(bytes: Uint8Array): ImageFormat | undefined {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'jpeg'
  }
  if (bytes[0] === 0x89 && strFromU8(bytes.subarray(1, 4)) === 'PNG') {
    return 'png'
  }
  return undefined
}

function markedJpeg(marker: string): Buffer {
  const text = Buffer.from(marker, 'latin1')
  const length = Buffer.alloc(2)
  length.writeUInt16BE(text.length + 2)
  const comment = Buffer.concat([Buffer.from([0xff, 0xfe]), length, text])
  return Buffer.concat([
    TINY_JPEG.subarray(0, 2),
    comment,
    TINY_JPEG.subarray(2)
  ])
}

function markedPng(marker: string): Buffer {
  const typeAndData = Buffer.from(`tEXt${MARKER_KEYWORD}\0${marker}`, 'latin1')
  const length = Buffer.alloc(4)
  length.writeUInt32BE(typeAndData.length - 4)
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(typeAndData))
  const afterHeader = PNG_SIGNATURE_LENGTH + PNG_IHDR_CHUNK_LENGTH
  return Buffer.concat([
    TINY_PNG.subarray(0, afterHeader),
    length,
    typeAndData,
    crc,
    TINY_PNG.subarray(afterHeader)
  ])
}

function tinyImage(format: ImageFormat, marker: string): Buffer {
  return format === 'jpeg' ? markedJpeg(marker) : markedPng(marker)
}

function resourceStem(name: string): string {
  return basename(name).replace(/\.(?:jpe?g|png)$/, '')
}

/** A frame-snapshot inlines its screenshot as a data URI; only the payload is swapped, so every other byte of the line stays. */
function reduceInlineImages(text: string): string {
  return text.replace(
    DATA_IMAGE_URI,
    (uri, prefix: string, payload: string) => {
      const format = imageFormat(Buffer.from(payload.slice(0, 16), 'base64'))
      if (!format) {
        return uri
      }
      return `${prefix}${tinyImage(format, 'inline').toString('base64')}`
    }
  )
}

function reduceEntries(entries: Entries): Entries {
  const reduced: Entries = {}
  for (const [name, bytes] of Object.entries(entries)) {
    const format = imageFormat(bytes)
    if (format) {
      reduced[name] = tinyImage(format, resourceStem(name))
    } else if (name.endsWith('.trace')) {
      reduced[name] = Buffer.from(reduceInlineImages(strFromU8(bytes)), 'utf8')
    } else {
      reduced[name] = bytes
    }
  }
  return reduced
}

function ndjson(entries: Entries, suffix: string): TraceEvent[] {
  return Object.entries(entries)
    .filter(([name]) => name.endsWith(suffix))
    .flatMap(([, bytes]) => strFromU8(bytes).split('\n'))
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as TraceEvent)
}

interface Action {
  callId: string
  class: string
  title?: string
  method: string
  stack?: { file?: string }[]
}

function describeCommands(
  events: TraceEvent[],
  entries: Entries
): TraceFormatManifest['commands'] {
  const actions = events
    .filter((event) => event.type === 'before')
    .map((event) => event as unknown as Action)
    .filter((action) => action.class !== 'Tracing')
  const failedIds = new Set(
    events
      .filter(
        (event) => event.type === 'after' && (event.error || event.retriedError)
      )
      .map((event) => event.callId)
  )
  const actionIds = new Set(actions.map((action) => action.callId))
  const withSnapshotText = new Set(
    events
      .filter((event) => event.type === 'frame-snapshot')
      .map(
        (event) =>
          event.snapshot as { callId: string; pageId: string; wallTime: number }
      )
      .filter(
        (snap) =>
          actionIds.has(snap.callId) &&
          `resources/${snap.pageId}-${snap.wallTime}-snapshot.txt` in entries
      )
      .map((snap) => snap.callId)
  )
  return {
    count: actions.length,
    failed: actions.filter((action) => failedIds.has(action.callId)).length,
    titles: actions.map((action) => action.title ?? action.method).sort(),
    withSnapshotText: withSnapshotText.size,
    withCallSource: actions.filter((action) => action.stack?.[0]?.file).length
  }
}

function describeFrames(events: TraceEvent[], entries: Entries): string[] {
  return events
    .filter((event) => event.type === 'screencast-frame')
    .map((event) => event as { sha1: string; timestamp: number })
    .filter(({ sha1 }) =>
      ['', '.jpeg', '.png'].some((ext) => `resources/${sha1}${ext}` in entries)
    )
    .sort((a, b) => a.timestamp - b.timestamp)
    .map(({ sha1 }) => resourceStem(sha1))
}

function describeSourceFiles(events: TraceEvent[], entries: Entries): string[] {
  const files = events
    .filter((event) => event.type === 'before')
    .map((event) => (event as unknown as Action).stack?.[0]?.file)
    .filter((file): file is string => typeof file === 'string')
  return [...new Set(files)]
    .filter((file) => {
      const sha1 = createHash('sha1').update(file).digest('hex')
      return `resources/src@${sha1}.txt` in entries
    })
    .sort()
}

function describe(entries: Entries, source: string): TraceFormatManifest {
  const events = ndjson(entries, '.trace')
  const context = events.find((event) => event.type === 'context-options')
  const requests = ndjson(entries, '.network').filter(
    (entry) => typeof entry.snapshot === 'object' && entry.snapshot
  )
  const mutations = ndjson(entries, '.mutations').filter(
    (entry) => entry.__truncated__ !== true
  )
  return {
    source,
    ...(typeof context?.runner === 'string' ? { runner: context.runner } : {}),
    ...(typeof context?.browserName === 'string'
      ? { browserName: context.browserName }
      : {}),
    commands: describeCommands(events, entries),
    consoleLogs: events.filter((event) =>
      ['console', 'stdout', 'stderr'].includes(event.type ?? '')
    ).length,
    networkRequests: {
      count: requests.length,
      urls: [
        ...new Set(
          requests.map(
            (entry) =>
              (entry.snapshot as { request: { url: string } }).request.url
          )
        )
      ].sort()
    },
    mutations: {
      count: mutations.length,
      documentAnchors: mutations.filter(
        (entry) => typeof entry.url === 'string'
      ).length
    },
    frames: describeFrames(events, entries),
    sourceFiles: describeSourceFiles(events, entries),
    transcript: 'transcript.md' in entries
  }
}

function writeZip(entries: Entries, path: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const zip = new yazl.ZipFile()
    for (const [name, bytes] of Object.entries(entries)) {
      zip.addBuffer(Buffer.from(bytes), name, { mtime: ENTRY_MTIME })
    }
    zip.end()
    const chunks: Buffer[] = []
    zip.outputStream.on('data', (chunk: Buffer) => chunks.push(chunk))
    zip.outputStream.on('error', reject)
    zip.outputStream.on('end', () => {
      writeFileSync(path, Buffer.concat(chunks))
      resolve()
    })
  })
}

async function main(): Promise<void> {
  const [sourceZip, name, source] = process.argv.slice(2)
  if (!sourceZip || !name || !source) {
    throw new Error(
      'usage: tsx reduce-fixture.ts <source.zip> <fixture-name> "<where the zip came from>"'
    )
  }
  const entries = unzipSync(new Uint8Array(readFileSync(sourceZip)))
  const dir = fileURLToPath(new URL('.', import.meta.url))
  const manifest = describe(entries, source)
  await writeZip(reduceEntries(entries), `${dir}${name}.zip`)
  writeFileSync(`${dir}${name}.json`, `${JSON.stringify(manifest, null, 2)}\n`)
}

await main()
