// Fixture zips edited into shapes our writer never produces: a step that failed on its own, and no transcript.

import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { bytesZipSource } from '@wdio/devtools-trace/trace-reader'
import { traceActions } from '../src/action-list.js'
import { traceErrors } from '../src/errors.js'
import { openTraceSource } from '../src/open-trace.js'
import { traceSummary } from '../src/summary.js'
import { traceTranscript } from '../src/transcript.js'
import { fixtureBytes } from './traces.js'

const PASSING = 'wdio-mocha-2026-10-28-14977b93.zip'
const SECOND_TEST = 'call@8'

// A hook that throws ends its test's step with an error while every action in it passed.
function withFailedStep(callId: string, message: string): Uint8Array {
  const entries = unzipSync(fixtureBytes(PASSING))
  const lines = strFromU8(entries['trace.trace']!)
    .split('\n')
    .map((line) => {
      if (!line) {
        return line
      }
      const event = JSON.parse(line) as Record<string, unknown>
      return event.type === 'after' && event.callId === callId
        ? JSON.stringify({ ...event, error: { message } })
        : line
    })
  entries['trace.trace'] = strToU8(lines.join('\n'))
  return zipSync(entries)
}

describe('a trace failed by a step alone', () => {
  it('lists the step as the error and its first error', async () => {
    const handle = await openTraceSource(
      bytesZipSource(withFailedStep(SECOND_TEST, 'afterEach hook failed'))
    )
    const summary = traceSummary(handle)
    expect(summary).toMatchObject({
      outcome: 'failed',
      counts: { failedActions: 0, failedSteps: 1 },
      firstError: {
        kind: 'step',
        callId: SECOND_TEST,
        title: 'shows an error message for an invalid username',
        message: 'afterEach hook failed'
      }
    })
    expect(traceErrors(handle).items).toEqual([summary.firstError])
    expect(
      summary.tests?.find((test) => test.callId === SECOND_TEST)?.outcome
    ).toBe('failed')
    expect(
      traceActions(handle, { group: SECOND_TEST }).items.length
    ).toBeGreaterThan(0)
  })

  it('lists nothing for a passing trace', async () => {
    const handle = await openTraceSource(bytesZipSource(fixtureBytes(PASSING)))
    expect(traceSummary(handle).firstError).toBeUndefined()
    expect(traceErrors(handle).items).toEqual([])
  })
})

describe('traceTranscript', () => {
  it('returns nothing for a zip that carries no transcript', async () => {
    const entries = unzipSync(fixtureBytes(PASSING))
    delete entries['transcript.md']
    const handle = await openTraceSource(bytesZipSource(zipSync(entries)))
    expect(traceTranscript(handle)).toBeUndefined()
  })
})
