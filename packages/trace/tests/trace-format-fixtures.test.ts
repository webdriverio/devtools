import { readdirSync, readFileSync } from 'node:fs'
import { beforeAll, describe, it, expect } from 'vitest'
import type { TracePlayerData } from '@wdio/devtools-shared'

import { parseTraceZip } from '../src/trace-reader.js'
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

function read(zipName: string): TracePlayerData {
  return parseTraceZip(
    new Uint8Array(readFileSync(new URL(zipName, FIXTURE_DIR)))
  )
}

function frameMarker(screenshot: string): string {
  return Buffer.from(screenshot, 'base64').toString('latin1')
}

describe('trace zips written by an older writer', () => {
  it.each(ADAPTERS)('has a fixture written by the %s adapter', (adapter) => {
    expect(fixtures.some(({ name }) => name.startsWith(`${adapter}-`))).toBe(
      true
    )
  })

  describe.each(fixtures)('$name', ({ zipName, manifest }) => {
    let parsed: TracePlayerData

    beforeAll(() => {
      parsed = read(zipName)
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

    it('pairs each screencast frame with its own image', () => {
      expect(
        parsed.frames.map((frame) => frameMarker(frame.screenshot))
      ).toEqual(
        manifest.frames.map((marker) => expect.stringContaining(marker))
      )
      if (parsed.frames.length) {
        expect(
          parsed.trace.commands.every((command) => command.screenshot)
        ).toBe(true)
      }
    })

    it('keeps the test sources and the transcript', () => {
      expect(Object.keys(parsed.trace.sources).sort()).toEqual(
        manifest.sourceFiles
      )
      expect(Boolean(parsed.transcript)).toBe(manifest.transcript)
    })
  })
})
