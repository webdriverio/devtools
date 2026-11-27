import { describe, expect, it } from 'vitest'
import type { CommandLog } from '@wdio/devtools-shared'
import { traceActionDetail } from '../src/action-detail.js'
import { traceActions } from '../src/action-list.js'
import { traceSummary } from '../src/summary.js'
import { traceErrors } from '../src/errors.js'
import { traceTranscript } from '../src/transcript.js'
import { MIN_QUERY_CHARS } from '../src/constants.js'
import type { TraceHandle } from '../src/types.js'
import { fixtures, openFixture, openWritten } from './traces.js'

const START = 1_700_000_000_000
const SPEC = '/project/specs/budget.e2e.ts'
const SOURCE = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join('\n')

function row(
  command: string,
  startOffset: number,
  endOffset: number,
  extra: Partial<CommandLog> = {}
): CommandLog {
  return {
    command,
    args: [],
    startTime: START + startOffset,
    timestamp: START + endOffset,
    ...extra
  }
}

const size = (value: unknown) => JSON.stringify(value).length

describe('results within their budget', () => {
  it('sheds a wait’s rows so every page of actions fits a small budget', async () => {
    const polls = Array.from({ length: 25 }, (_, i) =>
      row('getText', 110 + i * 10, 115 + i * 10, {
        parentId: 1,
        args: [`#field-${i}`]
      })
    )
    const handle = await openWritten({
      commands: [row('waitUntil', 100, 900, { id: 1 }), ...polls],
      startTime: START
    })
    for (const maxChars of [1_000, 1_200, 1_500]) {
      const page = traceActions(handle, { maxChars })
      expect(size(page)).toBeLessThanOrEqual(maxChars)
      expect(page.items[0]!.omittedChildren).toBeGreaterThan(5)
    }
  })

  it('cuts the first error, then leaves the tree out, so a summary fits its budget', async () => {
    const uids = Array.from({ length: 12 }, (_, i) => `t${i}`)
    const handle = await openWritten({
      commands: uids.map((uid, i) =>
        row('click', 100 + i * 20, 110 + i * 20, {
          testUid: uid,
          ...(i === 0
            ? { error: { name: 'Error', message: `boom ${'x'.repeat(2_000)}` } }
            : {})
        })
      ),
      testMetadata: new Map(
        uids.map((uid) => [
          uid,
          { title: `${uid} ${'y'.repeat(80)}`, specFile: SPEC, ancestry: [] }
        ])
      ),
      startTime: START
    })
    const whole = size(traceSummary(handle))
    expect(whole).toBeGreaterThan(1_500)
    for (const maxChars of [1_000, 1_200, whole - 100]) {
      const summary = traceSummary(handle, { maxChars })
      expect(size(summary)).toBeLessThanOrEqual(maxChars)
      expect(summary.firstError?.message.startsWith('boom')).toBe(true)
    }
  })

  it('drops the call’s own source line before cutting any value', async () => {
    const handle = await openWritten({
      commands: [
        row('setValue', 100, 200, {
          args: ['#field', 'v'.repeat(1_500)],
          callSource: `${SPEC}:5`
        })
      ],
      sources: { [SPEC]: SOURCE },
      startTime: START
    })
    const { callId } = traceActions(handle).items[0]!
    const whole = traceActionDetail(handle, callId, { contextLines: 0 })
    expect(whole.source).toHaveLength(1)
    const { source: _source, ...withoutSource } = whole
    const detail = traceActionDetail(handle, callId, {
      contextLines: 0,
      maxChars: size(withoutSource)
    })
    expect(detail.source).toBeUndefined()
    expect(detail.args).toEqual(whole.args)
  })

  it(`refuses a budget below ${MIN_QUERY_CHARS} characters in every query`, async () => {
    const handle = await openWritten({
      commands: [row('click', 100, 200)],
      startTime: START
    })
    const maxChars = MIN_QUERY_CHARS - 1
    const { callId } = traceActions(handle).items[0]!
    for (const query of [
      () => traceSummary(handle, { maxChars }),
      () => traceErrors(handle, { maxChars }),
      () => traceActions(handle, { maxChars }),
      () => traceActionDetail(handle, callId, { maxChars }),
      () => traceTranscript(handle, { maxChars })
    ]) {
      expect(query).toThrow(`maxChars must be at least ${MIN_QUERY_CHARS}`)
    }
  })
})

async function hostileTrace(): Promise<TraceHandle> {
  const long = (n: number) => 'x'.repeat(n)
  return openWritten({
    commands: [
      row('waitUntil', 100, 900, {
        id: 1,
        args: [long(5_000)],
        callSource: `${SPEC}:3`,
        error: { name: 'Error', message: long(5_000) }
      }),
      ...Array.from({ length: 25 }, (_, i) =>
        row('getText', 110 + i * 10, 115 + i * 10, {
          parentId: 1,
          args: [`#${long(400)}`],
          error: { name: 'Error', message: long(800) }
        })
      ),
      row('click', 1_000, 1_100, {
        title: long(3_000),
        args: [long(5_000)],
        selector: long(5_000),
        callSource: `${SPEC}:5`,
        error: { name: 'Error', message: long(5_000) }
      })
    ],
    sources: {
      [SPEC]: Array.from({ length: 200 }, () => long(500)).join('\n')
    },
    startTime: START
  })
}

describe('every query within every budget it accepts', () => {
  it('holds on every adapter fixture and on a trace of oversized values', async () => {
    const traces: [string, TraceHandle][] = [
      ['hostile', await hostileTrace()],
      ...(await Promise.all(
        fixtures.map(
          async ({ zipName }) =>
            [zipName, await openFixture(zipName)] as [string, TraceHandle]
        )
      ))
    ]
    const over: string[] = []
    for (const [name, handle] of traces) {
      const callId = traceActions(handle).items[0]?.callId
      for (const maxChars of [
        MIN_QUERY_CHARS,
        1_200,
        1_500,
        2_000,
        5_000,
        20_000
      ]) {
        const results: [string, unknown][] = [
          ['summary', traceSummary(handle, { maxChars })],
          ['errors', traceErrors(handle, { maxChars })],
          ['actions', traceActions(handle, { maxChars })],
          ['transcript', traceTranscript(handle, { maxChars })],
          ...(callId
            ? [
                ['detail', traceActionDetail(handle, callId, { maxChars })] as [
                  string,
                  unknown
                ]
              ]
            : [])
        ]
        for (const [query, result] of results) {
          if (size(result ?? null) > maxChars) {
            over.push(`${name} ${query} at ${maxChars}: ${size(result)}`)
          }
        }
      }
    }
    expect(over).toEqual([])
  })
})
