import { readdirSync, readFileSync } from 'node:fs'
import { basename } from 'node:path'
import { beforeAll, describe, it, expect } from 'vitest'
import { nearestFrame, type TracePlayerData } from '@wdio/devtools-shared'

import {
  openTraceArchive,
  parseTraceZip,
  readTracePayload,
  type TraceArchive
} from '../src/trace-reader.js'
import { bytesZipSource } from '../src/zip-index.js'
import type { TraceFormatManifest } from './fixtures/trace-formats/fixture-manifest.js'

// Fixture names start with the example they came from, so each adapter's format stays covered.
const ADAPTERS = ['wdio', 'selenium', 'nightwatch', 'python']
const FIXTURE_DIR = new URL('./fixtures/trace-formats/', import.meta.url)

const fixtures = readdirSync(FIXTURE_DIR)
  .filter((name) => name.endsWith('.zip'))
  .map((zipName) => {
    const name = zipName.slice(0, -'.zip'.length)
    const manifest = JSON.parse(
      readFileSync(new URL(`${name}.json`, FIXTURE_DIR), 'utf8')
    ) as TraceFormatManifest
    return { name, zipName, manifest }
  })

function zipBytes(zipName: string): Uint8Array {
  return new Uint8Array(readFileSync(new URL(zipName, FIXTURE_DIR)))
}

function frameMarker(image: Uint8Array): string {
  return Buffer.from(image).toString('latin1')
}

function entryStem(entry: string): string {
  return basename(entry).replace(/\.(?:jpe?g|png)$/, '')
}

// Frames as resources (#508) and stored stylesheets and fonts (#533).
function isCurrentFormat(manifest: TraceFormatManifest): boolean {
  return (
    manifest.inlineScreenshots === 0 &&
    manifest.snapshotScreenshots.length > 0 &&
    manifest.pageResources.length > 0
  )
}

describe('trace zips written by an older writer', () => {
  it.each(ADAPTERS)('has a fixture written by the %s adapter', (adapter) => {
    expect(fixtures.some(({ name }) => name.startsWith(`${adapter}-`))).toBe(
      true
    )
  })

  it.each(ADAPTERS)(
    'has a fixture of the current format written by the %s adapter',
    (adapter) => {
      expect(
        fixtures.some(
          ({ name, manifest }) =>
            name.startsWith(`${adapter}-`) && isCurrentFormat(manifest)
        )
      ).toBe(true)
    }
  )

  describe.each(fixtures)('$name', ({ zipName, manifest }) => {
    let parsed: TracePlayerData
    let archive: TraceArchive

    beforeAll(async () => {
      archive = await openTraceArchive(bytesZipSource(zipBytes(zipName)))
      parsed = await readTracePayload(archive)
    })

    it('reads the same payload through the archive as from the whole zip', () => {
      expect(parsed).toEqual(parseTraceZip(zipBytes(zipName)))
    })

    it('keeps its metadata', () => {
      expect(parsed.trace.metadata.runner).toBe(manifest.runner)
      expect(parsed.trace.metadata.capabilities).toEqual(
        manifest.browserName
          ? expect.objectContaining({ browserName: manifest.browserName })
          : undefined
      )
      expect(parsed.startTime).toBeGreaterThan(0)
      expect(parsed.duration).toBeGreaterThan(0)
    })

    it('keeps every command, its title and its outcome', () => {
      expect(parsed.trace.commands).toHaveLength(manifest.commands.count)
      expect(
        parsed.trace.commands.map((command) => command.title).sort()
      ).toEqual(manifest.commands.titles)
      expect(
        parsed.trace.commands.filter((command) => command.error)
      ).toHaveLength(manifest.commands.failed)
      expect(
        parsed.trace.commands.filter((command) => command.snapshotText)
      ).toHaveLength(manifest.commands.withSnapshotText)
      expect(
        parsed.trace.commands.filter((command) => command.callSource)
      ).toHaveLength(manifest.commands.withCallSource)
    })

    it('keeps console output, network requests and DOM mutations', () => {
      expect(parsed.trace.consoleLogs).toHaveLength(manifest.consoleLogs)
      expect(parsed.trace.networkRequests).toHaveLength(
        manifest.networkRequests.count
      )
      expect(
        [
          ...new Set(parsed.trace.networkRequests.map((request) => request.url))
        ].sort()
      ).toEqual(manifest.networkRequests.urls)
      expect(parsed.trace.mutations).toHaveLength(manifest.mutations.count)
      expect(
        parsed.trace.mutations.filter((mutation) => mutation.url)
      ).toHaveLength(manifest.mutations.documentAnchors)
    })

    it('pairs each screencast frame with its own image', async () => {
      const images = await Promise.all(
        parsed.frames.map((frame) => archive.read(frame.entry))
      )
      expect(images.map(frameMarker)).toEqual(
        manifest.frames.map((marker) => expect.stringContaining(marker))
      )
      if (parsed.frames.length) {
        expect(
          parsed.trace.commands.every((command) =>
            nearestFrame(parsed.frames, command.timestamp)
          )
        ).toBe(true)
      }
    })

    it('resolves each frame-snapshot screenshot to its stored image', async () => {
      const images = await Promise.all(
        manifest.snapshotScreenshots.map((entry) => archive.read(entry))
      )
      expect(images.map(frameMarker)).toEqual(
        manifest.snapshotScreenshots.map((entry) =>
          expect.stringContaining(entryStem(entry))
        )
      )
    })

    it('names each stored stylesheet and font by the entry holding its bytes', async () => {
      const resources = parsed.pageResources ?? []
      expect(
        resources.map(({ url, kind, mimeType, size }) => ({
          url,
          kind,
          mimeType,
          size
        }))
      ).toEqual(manifest.pageResources)
      const bodies = await Promise.all(
        resources.map(({ entry }) => archive.read(entry))
      )
      expect(bodies.map((body) => body.length)).toEqual(
        manifest.pageResources.map(({ size }) => size)
      )
    })

    it('keeps the test sources and the transcript', () => {
      expect(Object.keys(parsed.trace.sources).sort()).toEqual(
        manifest.sourceFiles
      )
      expect(Boolean(parsed.transcript)).toBe(manifest.transcript)
    })
  })
})
