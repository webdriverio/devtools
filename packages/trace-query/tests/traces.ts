// Opens the committed older-writer fixtures, and writes a trace with this checkout's writer for what no fixture holds.

import { readdirSync, readFileSync } from 'node:fs'
import {
  TraceType,
  type CommandLog,
  type ConsoleLog,
  type NetworkRequest,
  type TestMetadataMap
} from '@wdio/devtools-shared'
import { exportTraceZip } from '@wdio/devtools-trace/trace-exporter'
import { bytesZipSource } from '@wdio/devtools-trace/trace-reader'
import type { TraceFormatManifest } from '../../trace/tests/fixtures/trace-formats/fixture-manifest.js'
import { openTraceSource } from '../src/open-trace.js'
import type { TraceHandle } from '../src/types.js'

const FIXTURE_DIR = new URL(
  '../../trace/tests/fixtures/trace-formats/',
  import.meta.url
)

export const fixtures = readdirSync(FIXTURE_DIR)
  .filter((name) => name.endsWith('.zip'))
  .map((zipName) => ({
    zipName,
    manifest: JSON.parse(
      readFileSync(
        new URL(zipName.replace(/\.zip$/, '.json'), FIXTURE_DIR),
        'utf8'
      )
    ) as TraceFormatManifest
  }))

export function fixtureBytes(zipName: string): Uint8Array {
  return new Uint8Array(readFileSync(new URL(zipName, FIXTURE_DIR)))
}

export function openFixture(zipName: string): Promise<TraceHandle> {
  return openTraceSource(bytesZipSource(fixtureBytes(zipName)))
}

export interface WrittenRun {
  commands: CommandLog[]
  consoleLogs?: ConsoleLog[]
  networkRequests?: NetworkRequest[]
  sources?: Record<string, string>
  testMetadata?: TestMetadataMap
  startTime: number
  /** Chrome unless named. */
  browserName?: string
}

/** A run written to a zip by this checkout's writer, then opened as a caller would. */
export async function openWritten(run: WrittenRun): Promise<TraceHandle> {
  const zip = await exportTraceZip(
    {
      mutations: [],
      logs: [],
      consoleLogs: run.consoleLogs ?? [],
      networkRequests: run.networkRequests ?? [],
      commands: run.commands,
      sources: run.sources ?? {},
      metadata: {
        type: TraceType.Testrunner,
        sessionId: 'abc12345',
        runner: 'mocha',
        capabilities: { browserName: run.browserName ?? 'chrome' }
      }
    },
    {
      sessionId: 'abc12345',
      wallTimeOverride: run.startTime,
      testMetadata: run.testMetadata
    }
  )
  return openTraceSource(bytesZipSource(new Uint8Array(zip)))
}

/** Every page of a listing, from the first to the one without a cursor. */
export function allPages<P extends { nextCursor?: string }>(
  page: (cursor: string | undefined) => P
): P[] {
  const pages = [page(undefined)]
  while (pages[pages.length - 1]!.nextCursor !== undefined) {
    pages.push(page(pages[pages.length - 1]!.nextCursor))
  }
  return pages
}
