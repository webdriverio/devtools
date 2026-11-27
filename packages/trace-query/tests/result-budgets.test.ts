import { describe, expect, it } from 'vitest'
import type { CommandLog } from '@wdio/devtools-shared'
import { traceActionDetail } from '../src/action-detail.js'
import { traceActions } from '../src/action-list.js'
import { traceSummary } from '../src/summary.js'
import { traceErrors } from '../src/errors.js'
import { traceTranscript } from '../src/transcript.js'
import { traceConsole } from '../src/console.js'
import { traceNetwork } from '../src/network.js'
import { traceNetworkRequest } from '../src/network-request.js'
import { traceStateOf } from '../src/open-trace.js'
import { traceSnapshot } from '../src/trace-snapshot.js'
import { MIN_QUERY_CHARS } from '../src/constants.js'
import type { TraceHandle } from '../src/types.js'
import { capture } from './page-state-traces.js'
import { allPages, fixtures, openFixture, openWritten } from './traces.js'

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
      () => traceTranscript(handle, { maxChars }),
      () => traceConsole(handle, { maxChars }),
      () => traceNetwork(handle, { maxChars }),
      () => traceSnapshot(handle, callId, { maxChars })
    ]) {
      expect(query).toThrow(`maxChars must be at least ${MIN_QUERY_CHARS}`)
    }
    await expect(
      traceNetworkRequest(handle, '0', { maxChars })
    ).rejects.toThrow(`maxChars must be at least ${MIN_QUERY_CHARS}`)
  })
})

async function hostileTrace(): Promise<TraceHandle> {
  const long = (n: number) => 'x'.repeat(n)
  // Each of these serializes to more than one character: a control character to six, a quote and a backslash to two.
  const escaping = (n: number) =>
    '\u0001"\\'.repeat(Math.ceil(n / 3)).slice(0, n)
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
        title: escaping(3_000),
        args: [long(5_000)],
        selector: long(5_000),
        callSource: `${SPEC}:5`,
        error: { name: 'Error', message: long(5_000) }
      })
    ],
    sources: {
      [SPEC]: Array.from({ length: 200 }, () => long(500)).join('\n')
    },
    actionSnapshots: [
      capture(
        START + 1_100,
        [
          `[Page: ${escaping(5_000)}]`,
          ...Array.from(
            { length: 200 },
            (_, i) =>
              `${'  '.repeat((i % 6) + 1)}link "${i % 2 ? escaping(500) : long(500)}" ∈ "${long(300)}"  →  //a[contains(., "${escaping(3_000)}")]`
          )
        ].join('\n')
      )
    ],
    consoleLogs: Array.from({ length: 30 }, (_, i) => ({
      type: i % 2 ? 'error' : 'warn',
      args: [`"${long(3_000)}"\n${long(i * 50)}`],
      timestamp: START + 100 + i,
      source: 'browser'
    })),
    networkRequests: Array.from({ length: 30 }, (_, i) => ({
      id: `${i}`,
      url: `https://${long(200)}.example/${long(5_000)}`,
      method: long(500),
      type: 'fetch',
      timestamp: START + 100 + i,
      startTime: START + 100 + i,
      endTime: START + 110 + i,
      status: i % 2 ? 500 : 0,
      statusText: long(2_000),
      requestHeaders: Object.fromEntries(
        Array.from({ length: 40 }, (_, h) => [`${long(300)}${h}`, long(3_000)])
      ),
      responseBody: `"${long(50_000)}"`,
      response: {
        fromCache: false,
        headers: {},
        mimeType: long(400),
        status: i % 2 ? 500 : 0
      }
    })),
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
      const requestId = traceNetwork(handle).items[0]?.id
      const { commands } = traceStateOf(handle).data.trace
      const lastCallId = commands[commands.length - 1]!.callId!
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
          ...allPages((cursor) =>
            traceConsole(handle, { levels: [], maxChars, cursor })
          ).map(
            (page, at) => [`console page ${at}`, page] as [string, unknown]
          ),
          ...allPages((cursor) =>
            traceNetwork(handle, { maxChars, cursor })
          ).map(
            (page, at) => [`network page ${at}`, page] as [string, unknown]
          ),
          ...allPages((cursor) =>
            traceSnapshot(handle, lastCallId, { maxChars, cursor })!
          ).map(
            (page, at) => [`snapshot page ${at}`, page] as [string, unknown]
          ),
          ...allPages((cursor) =>
            traceSnapshot(handle, lastCallId, {
              maxChars,
              cursor,
              text: 'link'
            })!
          ).map(
            (page, at) =>
              [`scoped snapshot page ${at}`, page] as [string, unknown]
          ),
          ...(requestId
            ? [
                [
                  'request',
                  await traceNetworkRequest(handle, requestId, {
                    body: true,
                    maxChars
                  })
                ] as [string, unknown]
              ]
            : []),
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
