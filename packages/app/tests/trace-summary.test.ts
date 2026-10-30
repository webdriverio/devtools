// A zip records no test state, so the outcome the run list shows is read from
// the rows. These open zips from the real writer, so what the list derives is
// checked against what an adapter actually leaves on disk.

import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
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
  traceLabelFromPath,
  traceOutcome,
  TRACE_OUTCOME
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

/** A parsed trace holding `commands` and nothing else. */
function playerData(
  commands: CommandLog[],
  groups?: TracePlayerData['groups']
): TracePlayerData {
  return {
    trace: {
      mutations: [],
      logs: [],
      consoleLogs: [],
      networkRequests: [],
      commands,
      sources: {},
      metadata: { type: TraceType.Testrunner }
    },
    frames: [],
    startTime: 0,
    duration: 0,
    groups
  }
}

const row = (command: string, timestamp: number, extra = {}): CommandLog => ({
  command,
  args: ['#login'],
  timestamp,
  testUid: 'test-1',
  ...extra
})

describe('traceOutcome', () => {
  it('reads a trace whose actions all passed as passed', async () => {
    const data = await perTestZip([row('url', 2000), row('click', 3000)])

    expect(traceOutcome(data)).toBe(TRACE_OUTCOME.PASSED)
  })

  it('reads a trace with a failed action as failed', async () => {
    const data = await perTestZip([
      row('url', 2000),
      row('click', 3000, { error: { name: 'Error', message: 'not found' } })
    ])

    expect(traceOutcome(data)).toBe(TRACE_OUTCOME.FAILED)
  })

  it('reads a failed assertion that carries no error as failed', async () => {
    const data = await perTestZip([
      row('assert.equal', 2000, {
        args: ['a', 'b'],
        result: { passed: false, actual: 'a', expected: 'b' }
      })
    ])

    expect(traceOutcome(data)).toBe(TRACE_OUTCOME.FAILED)
  })

  it('does not count a poll a passing wait retried past', async () => {
    const data = await perTestZip([
      row('waitUntil', 3000, { id: 7, startTime: 2000 }),
      row('isDisplayed', 2100, {
        parentId: 7,
        error: { name: 'Error', message: 'stale element' }
      })
    ])

    expect(traceOutcome(data)).toBe(TRACE_OUTCOME.PASSED)
  })

  it('has no outcome for a trace with no actions', () => {
    const data = playerData([])

    expect(traceOutcome(data)).toBe(TRACE_OUTCOME.UNKNOWN)
  })

  it('reads a step that failed on its own as failed', () => {
    const data = playerData(
      [],
      [
        {
          group: {
            callId: 'g1',
            title: 'Login',
            startTime: 0,
            endTime: 1,
            children: [
              {
                group: {
                  callId: 'g2',
                  title: 'logs in',
                  startTime: 0,
                  endTime: 1,
                  failed: true,
                  children: []
                }
              }
            ]
          }
        }
      ]
    )

    expect(traceOutcome(data)).toBe(TRACE_OUTCOME.FAILED)
  })
})

describe('summarizeTrace', () => {
  it('names the one test a per-test zip holds, suites first', async () => {
    const data = await perTestZip([row('url', 2000), row('click', 3000)])

    expect(summarizeTrace(data)).toMatchObject({
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
