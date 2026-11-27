// What the run list shows for a zip, read from zips the real writer leaves on disk.

import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  TRACE_OUTCOME,
  TraceType,
  type CommandLog,
  type TestMetadataMap,
  type TracePlayerData
} from '@wdio/devtools-shared'
// eslint-disable-next-line no-restricted-imports -- builds a zip as an adapter does; app source never writes one
import { writeTraceZip } from '@wdio/devtools-trace/trace-exporter'
import { parseTraceZip } from '@wdio/devtools-trace/trace-reader'

import {
  summarizeTrace,
  traceLabelFromPath
} from '../src/utils/trace-summary.js'

const dirs: string[] = []

afterEach(async () => {
  await Promise.all(
    dirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true }))
  )
})

const metadata: TestMetadataMap = new Map([
  [
    'test-1',
    {
      title: 'logs in',
      specFile: 'login.spec.ts',
      ancestry: [{ uid: 'suite-1', title: 'Login', kind: 'suite' }]
    }
  ]
])

async function perTestZip(commandsLog: CommandLog[]): Promise<TracePlayerData> {
  const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'trace-summary-'))
  dirs.push(outputDir)
  const zip = await writeTraceZip(
    {
      mutations: [],
      traceLogs: [],
      consoleLogs: [],
      networkRequests: [],
      commandsLog,
      sources: new Map(),
      metadata: { type: TraceType.Testrunner, sessionId: 'abc12345' },
      startWallTime: 1000
    },
    {
      outputDir,
      sessionId: 'abc12345',
      testMetadata: metadata,
      fileStem: 'trace'
    }
  )
  return parseTraceZip(new Uint8Array(await fs.readFile(zip)))
}

const row = (command: string, timestamp: number, extra = {}): CommandLog => ({
  command,
  args: ['#login'],
  timestamp,
  testUid: 'test-1',
  ...extra
})

describe('summarizeTrace', () => {
  it('names the one test a per-test zip holds, suites first', async () => {
    const data = await perTestZip([row('url', 2000), row('click', 3000)])

    expect(summarizeTrace(data)).toMatchObject({
      outcome: TRACE_OUTCOME.PASSED,
      titlePath: ['Login', 'logs in'],
      startTime: data.startTime
    })
  })

  it('names no test when the zip holds no test groups', async () => {
    const data = await perTestZip([
      { command: 'url', args: ['https://example.com'], timestamp: 2000 }
    ])

    expect(summarizeTrace(data).titlePath).toBeUndefined()
  })
})

describe('traceLabelFromPath', () => {
  it('names a per-test trace.zip by its folder', () => {
    expect(traceLabelFromPath('run/login-logs-in-chrome/trace.zip')).toBe(
      'login-logs-in-chrome'
    )
  })

  it('names any other zip by its own name', () => {
    expect(traceLabelFromPath('test-results/trace-abc123.zip')).toBe(
      'trace-abc123'
    )
    expect(traceLabelFromPath('trace.zip')).toBe('trace')
  })
})
