// A run no fixture holds, written by this checkout's writer: retried and failed polls, a failed assertion, console and network failures.

import { describe, expect, it } from 'vitest'
import type { CommandLog, NetworkRequest } from '@wdio/devtools-shared'
import { traceActionDetail } from '../src/action-detail.js'
import { traceActions } from '../src/action-list.js'
import {
  DEFAULT_MAX_CHARS,
  MAX_LISTED_CHILDREN,
  MAX_TITLE_CHARS
} from '../src/constants.js'
import { traceErrors } from '../src/errors.js'
import { traceSummary } from '../src/summary.js'
import { traceTranscript } from '../src/transcript.js'
import type { ActionRow, TraceHandle } from '../src/types.js'
import { openWritten } from './traces.js'

const START = 1_700_000_000_000
const SPEC = '/project/specs/login.e2e.ts'
const SPEC_SOURCE = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join(
  '\n'
)
const LONG_TEST = `asserts the heading ${'x'.repeat(200)}`
const LONG_SELECTOR = `#${'a'.repeat(500)}`

const at = (offset: number) => START + offset

function row(
  command: string,
  startOffset: number,
  endOffset: number,
  extra: Partial<CommandLog> = {}
): CommandLog {
  return {
    command,
    args: [],
    startTime: at(startOffset),
    timestamp: at(endOffset),
    ...extra
  }
}

const COMMANDS: CommandLog[] = [
  row('url', 100, 400, {
    args: ['http://127.0.0.1:4567/login'],
    testUid: 'retries',
    callSource: `${SPEC}:3`
  }),
  row('waitUntil', 500, 900, { id: 1, testUid: 'retries' }),
  row('isDisplayed', 600, 650, {
    parentId: 1,
    testUid: 'retries',
    error: { name: 'Error', message: 'stale element reference' }
  }),
  row('getText', 700, 750, {
    parentId: 1,
    testUid: 'retries',
    result: 'x'.repeat(5_000)
  }),
  row('waitForDisplayed', 1_000, 2_000, {
    id: 2,
    args: ['#never'],
    testUid: 'times-out',
    error: { name: 'Error', message: 'element ("#never") still not displayed' }
  }),
  row('isDisplayed', 1_100, 1_150, {
    parentId: 2,
    testUid: 'times-out',
    error: { name: 'Error', message: 'no such element' }
  }),
  row('isExisting', 1_200, 1_250, {
    parentId: 2,
    testUid: 'times-out',
    result: true
  }),
  row('assert.equal', 2_100, 2_101, {
    args: ['Login Page', 'Secure Area'],
    testUid: 'asserts',
    result: { passed: false, actual: 'Login Page', expected: 'Secure Area' },
    callSource: `${SPEC}:9`
  }),
  row('click', 2_200, 2_300, {
    args: [LONG_SELECTOR],
    selector: LONG_SELECTOR,
    testUid: 'asserts'
  })
]

function request(
  id: string,
  offset: number,
  extra: Partial<NetworkRequest>
): NetworkRequest {
  return {
    id,
    url: `http://127.0.0.1:4567/${id}`,
    method: 'GET',
    type: 'fetch',
    timestamp: at(offset),
    startTime: at(offset),
    endTime: at(offset + 10),
    ...extra
  }
}

const TEST_METADATA = new Map(
  [
    ['retries', 'retries a stale poll'],
    ['times-out', 'times out'],
    ['asserts', LONG_TEST]
  ].map(([uid, title]) => [
    uid,
    {
      title,
      specFile: SPEC,
      ancestry: [{ uid: 'login', title: 'Login', kind: 'suite' as const }]
    }
  ])
)

function openRun(): Promise<TraceHandle> {
  return openWritten({
    commands: COMMANDS,
    consoleLogs: [
      {
        type: 'error',
        args: ['\u001b[31mUncaught TypeError\u001b[39m', { at: 'app.js' }],
        timestamp: at(50),
        source: 'browser'
      },
      { type: 'log', args: ['ready'], timestamp: at(60), source: 'browser' }
    ],
    networkRequests: [
      request('ok', 150, { status: 200, statusText: 'OK' }),
      // Nearer the timed-out wait's start, but issued while the passing wait was the last action started.
      request('broken', 980, { status: 500, statusText: 'Server Error' }),
      request('blocked', 2_150, { status: 0 })
    ],
    sources: { [SPEC]: SPEC_SOURCE },
    testMetadata: TEST_METADATA,
    startTime: START
  })
}

function flattenRows(rows: readonly ActionRow[]): ActionRow[] {
  return rows.flatMap((item) => [item, ...flattenRows(item.children ?? [])])
}

function byTitle(rows: readonly ActionRow[], prefix: string): ActionRow {
  const found = flattenRows(rows).find((candidate) =>
    candidate.title.startsWith(prefix)
  )
  expect(found, prefix).toBeDefined()
  return found!
}

const titles = (rows: readonly ActionRow[]) =>
  rows.map((item) => item.title.split('(')[0])

describe('a trace with waits and failures', () => {
  it('nests a wait’s polls under it and does not fail a poll the wait retried past', async () => {
    const { items } = traceActions(await openRun())
    expect(titles(items)).toEqual([
      'Page.navigate',
      'Browser.waitForFunction',
      'Element.waitForDisplayed',
      'assert.equal',
      'Element.click'
    ])
    const passingWait = byTitle(items, 'Browser.waitForFunction')
    expect(passingWait.status).toBeUndefined()
    expect(passingWait.children).toEqual([
      expect.objectContaining({
        status: 'retried',
        error: 'stale element reference'
      }),
      expect.not.objectContaining({ status: expect.anything() })
    ])
    const failedWait = byTitle(items, 'Element.waitForDisplayed')
    expect(failedWait.status).toBe('failed')
    expect(failedWait.children).toEqual([
      expect.objectContaining({ status: 'failed', error: 'no such element' }),
      expect.not.objectContaining({ status: expect.anything() })
    ])
  })

  it('filters by status, test and time window', async () => {
    const handle = await openRun()
    expect(titles(traceActions(handle, { status: 'retried' }).items)).toEqual([
      'Browser.waitForFunction'
    ])
    expect(titles(traceActions(handle, { status: 'failed' }).items)).toEqual([
      'Element.waitForDisplayed',
      'assert.equal'
    ])
    expect(titles(traceActions(handle, { status: 'passed' }).items)).toEqual([
      'Page.navigate',
      'Browser.waitForFunction',
      'Element.click'
    ])
    const asserts = traceSummary(handle).tests?.[0]?.children?.[2]
    expect(
      titles(traceActions(handle, { group: asserts!.callId }).items)
    ).toEqual(['assert.equal', 'Element.click'])
    const wait = byTitle(traceActions(handle).items, 'Element.waitForDisplayed')
    expect(
      titles(
        traceActions(handle, {
          fromMs: wait.startMs + 1,
          toMs: wait.startMs + 2
        }).items
      )
    ).toEqual(['Element.waitForDisplayed'])
  })

  it('refuses a test it does not hold', async () => {
    const handle = await openRun()
    expect(() => traceActions(handle, { group: 'call@999' })).toThrow(
      'The trace has no test or step "call@999"'
    )
  })

  it('pages the action list, refusing a cursor from a differently filtered list', async () => {
    const handle = await openRun()
    const all = traceActions(handle).items
    const first = traceActions(handle, { maxChars: 300 })
    expect(JSON.stringify(first).length).toBeLessThanOrEqual(300)
    const rest = traceActions(handle, {
      maxChars: 100_000,
      cursor: first.nextCursor
    })
    expect([...first.items, ...rest.items]).toEqual(all)
    expect(() =>
      traceActions(handle, { status: 'passed', cursor: first.nextCursor })
    ).toThrow('belongs to a different listing')
  })

  it('cuts a long title in a list, saying how long it was', async () => {
    const click = byTitle(traceActions(await openRun()).items, 'Element.click')
    expect(click.title).toMatch(/… \(cut, \d+ chars\)$/)
    expect(click.title.length).toBeLessThanOrEqual(MAX_TITLE_CHARS)
  })

  it('lists each failure once, by start, each console line and request naming the action last started', async () => {
    const handle = await openRun()
    const callIdOf = (prefix: string) =>
      byTitle(traceActions(handle).items, prefix).callId
    expect(traceErrors(handle).items).toEqual([
      {
        kind: 'console',
        timeMs: 50,
        message: 'Uncaught TypeError {"at":"app.js"}'
      },
      expect.objectContaining({
        kind: 'request',
        timeMs: 980,
        callId: callIdOf('Browser.waitForFunction'),
        message: 'HTTP 500 Server Error',
        method: 'GET',
        status: 500
      }),
      expect.objectContaining({
        kind: 'action',
        timeMs: 1_000,
        callId: callIdOf('Element.waitForDisplayed'),
        message: 'element ("#never") still not displayed'
      }),
      expect.objectContaining({
        kind: 'action',
        timeMs: 2_100,
        message: 'Assertion failed'
      }),
      expect.objectContaining({
        kind: 'request',
        callId: callIdOf('assert.equal'),
        message: 'No response',
        status: 0
      })
    ])
  })

  it('summarizes the run, its first failed action and each test’s outcome', async () => {
    const summary = traceSummary(await openRun())
    expect(summary).toMatchObject({
      runner: 'mocha',
      browser: 'chrome',
      outcome: 'failed',
      counts: {
        actions: 5,
        failedActions: 2,
        failedSteps: 0,
        consoleErrors: 1,
        failedRequests: 2
      },
      firstError: {
        kind: 'action',
        message: 'element ("#never") still not displayed'
      }
    })
    const [suite] = summary.tests!
    expect(suite).toMatchObject({ title: 'Login', outcome: 'failed' })
    expect(suite!.children!.map(({ outcome }) => outcome)).toEqual([
      'passed',
      'failed',
      'failed'
    ])
    const longTitle = suite!.children![2]!.title
    expect(longTitle).toMatch(/^asserts the heading x+… \(cut, 220 chars\)$/)
    expect(longTitle.length).toBeLessThanOrEqual(MAX_TITLE_CHARS)
  })

  it('keeps only the failed tests, as many as fit, when the tree outgrows the budget', async () => {
    const handle = await openRun()
    const full = JSON.stringify(traceSummary(handle).tests).length
    const roomy = traceSummary(handle, { maxChars: 2 * full - 2 })
    expect(roomy.tests?.[0]?.children?.map(({ outcome }) => outcome)).toEqual([
      'failed',
      'failed'
    ])
    expect(roomy.omittedTests).toBe(1)
    const tight = traceSummary(handle, { maxChars: 300 })
    expect(JSON.stringify(tight.tests ?? []).length).toBeLessThanOrEqual(150)
    expect(tight.omittedTests).toBeGreaterThan(1)
  })

  it('refuses a bad budget even with no tests to bound', async () => {
    const handle = await openRun()
    expect(() => traceSummary(handle, { maxChars: 0 })).toThrow('maxChars')
  })

  it('details a failed assertion with expected, actual and its source lines', async () => {
    const handle = await openRun()
    const { callId } = byTitle(traceActions(handle).items, 'assert.equal')
    const detail = traceActionDetail(handle, callId, { contextLines: 1 })
    expect(detail).toMatchObject({
      callId,
      title: 'assert.equal("Login Page", "Secure Area")',
      command: 'assert.equal',
      startMs: 2_100,
      durationMs: 1,
      status: 'failed',
      args: '["Login Page","Secure Area"]',
      error: {
        message: 'Assertion failed',
        expected: '"Secure Area"',
        actual: '"Login Page"'
      },
      callSite: `${SPEC}:9`,
      source: ['  8 | line 8', '> 9 | line 9', ' 10 | line 10']
    })
    expect(detail.result).toBeUndefined()
    expect(detail.test?.[0]).toBe('Login')
    expect(detail.test?.[1]?.length).toBeLessThanOrEqual(MAX_TITLE_CHARS)
  })

  it('names a poll’s wait and a wait’s polls, cutting a long result and selector', async () => {
    const handle = await openRun()
    const { items } = traceActions(handle)
    const wait = byTitle(items, 'Browser.waitForFunction')
    const [poll, read] = wait.children!
    expect(traceActionDetail(handle, wait.callId).children).toEqual([
      poll!.callId,
      read!.callId
    ])
    expect(traceActionDetail(handle, poll!.callId)).toMatchObject({
      status: 'retried',
      parent: wait.callId,
      error: { message: 'stale element reference' }
    })
    expect(traceActionDetail(handle, read!.callId).result).toMatch(
      /^"x+… \(cut, 5002 chars\)$/
    )
    const click = traceActionDetail(
      handle,
      byTitle(items, 'Element.click').callId
    )
    expect(click.selector).toMatch(/^#a+… \(cut, 501 chars\)$/)
  })

  it('cuts a detail to the budget it is given', async () => {
    const handle = await openRun()
    const read = byTitle(traceActions(handle).items, 'Element.getText')
    expect(
      JSON.stringify(traceActionDetail(handle, read.callId)).length
    ).toBeGreaterThan(1_000)
    const small = traceActionDetail(handle, read.callId, { maxChars: 600 })
    expect(JSON.stringify(small).length).toBeLessThanOrEqual(600)
    expect(small.result).toMatch(/… \(cut, 5002 chars\)$/)
  })

  it('drops source lines before it cuts any field', async () => {
    const handle = await openRun()
    const { callId } = byTitle(traceActions(handle).items, 'assert.equal')
    const oneLine = traceActionDetail(handle, callId, { contextLines: 1 })
    const noLines = traceActionDetail(handle, callId, { contextLines: 0 })
    const fit = (maxChars: number) =>
      traceActionDetail(handle, callId, { contextLines: 3, maxChars })
    expect(fit(JSON.stringify(oneLine).length)).toEqual(oneLine)
    expect(fit(JSON.stringify(noLines).length)).toEqual(noLines)
  })

  it('keeps the largest detail within the default budget', async () => {
    const huge = 'y'.repeat(30_000)
    const handle = await openWritten({
      commands: [
        row('assert.equal', 100, 200, {
          title: huge,
          args: [huge, huge],
          selector: huge,
          result: { passed: false, actual: huge, expected: huge },
          callSource: `${SPEC}:9`
        })
      ],
      sources: { [SPEC]: Array.from({ length: 20 }, () => huge).join('\n') },
      startTime: START
    })
    const { callId } = traceActions(handle).items[0]!
    const detail = traceActionDetail(handle, callId, { contextLines: 50 })
    expect(JSON.stringify(detail).length).toBeLessThanOrEqual(DEFAULT_MAX_CHARS)
    expect(detail.source?.length).toBeGreaterThan(0)
  })

  it('lists the first of many rows a wait issued, counting the rest', async () => {
    const polls = Array.from({ length: MAX_LISTED_CHILDREN + 5 }, (_, i) =>
      row('getText', 110 + i * 10, 115 + i * 10, {
        parentId: 1,
        args: [`#field-${i}`]
      })
    )
    const handle = await openWritten({
      commands: [row('waitUntil', 100, 900, { id: 1 }), ...polls],
      startTime: START
    })
    const [wait] = traceActions(handle).items
    expect(wait!.children).toHaveLength(MAX_LISTED_CHILDREN)
    expect(wait!.omittedChildren).toBe(5)
    expect(traceActionDetail(handle, wait!.callId)).toMatchObject({
      children: wait!.children!.map(({ callId }) => callId),
      omittedChildren: 5
    })
  })

  it('refuses an action, a context or a budget it cannot serve', async () => {
    const handle = await openRun()
    expect(() => traceActionDetail(handle, 'call@999')).toThrow(
      'The trace has no action "call@999"'
    )
    const { callId } = traceActions(handle).items[0]!
    expect(() =>
      traceActionDetail(handle, callId, { contextLines: -1 })
    ).toThrow('contextLines must be an integer')
    expect(() => traceActionDetail(handle, callId, { maxChars: 0 })).toThrow(
      'maxChars'
    )
  })

  it('pages the transcript by line, each page within its budget', async () => {
    const handle = await openRun()
    const whole = traceTranscript(handle)!.items
    const lines: string[] = []
    let cursor: string | undefined
    do {
      const page = traceTranscript(handle, { maxChars: 80, cursor })!
      expect(JSON.stringify(page).length).toBeLessThanOrEqual(80)
      lines.push(...page.items)
      cursor = page.nextCursor
    } while (cursor)
    expect(lines).toHaveLength(whole.length)
    expect(lines.some((line) => /… \(cut, \d+ chars\)$/.test(line))).toBe(true)
  })
})
