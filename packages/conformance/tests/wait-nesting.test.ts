import { describe, expect, it } from 'vitest'

import type { CommandLog } from '@wdio/devtools-shared'

import { compareRuns } from '../src/agreement.js'
import { gapsFor, judge } from '../src/allowlist.js'
import { BIDI_MODES, RULES } from '../src/constants.js'
import { readStream } from '../src/checker.js'
import { normalizeRun } from '../src/normalize.js'
import { checkWaitNesting } from '../src/wait-nesting.js'
import type { AdapterId, RunReport, WireFrame } from '../src/types.js'

const WAITS_TEST = 'waits on what the page shows'
const LOGIN_TEST = 'logs in and reads the greeting'

const row = (
  command: string,
  startTime: number,
  timestamp: number,
  extra: Partial<CommandLog> = {}
): CommandLog => ({ command, args: [], startTime, timestamp, ...extra })

/** The waits test as the target shape: two condition waits, each sent running, its reads nested, then replaced. */
function nestedRun({
  readParent = (id: number) => id as number | undefined,
  sendWaitFirst = true,
  readSelector = 'h2'
} = {}): WireFrame[] {
  const wait = (id: number, start: number) =>
    row('waitUntil', start, start, { id })
  const done = (id: number, start: number, end: number) =>
    row('waitUntil', start, end, { id })
  const read = (id: number, parent: number, start: number, selector: string) =>
    row('getText', start, start + 2, {
      id,
      selector,
      ...(readParent(parent) === undefined
        ? {}
        : { parentId: readParent(parent) })
    })
  const first = [read(2, 1, 105, '#flash'), read(3, 1, 108, readSelector)]
  const commands: WireFrame[] = sendWaitFirst
    ? [
        { scope: 'commands', data: [wait(1, 100)] },
        { scope: 'commands', data: first }
      ]
    : [
        { scope: 'commands', data: first },
        { scope: 'commands', data: [wait(1, 100)] }
      ]
  return [
    { scope: 'metadata', data: { type: 'testrunner' } },
    {
      scope: 'suites',
      data: [
        {
          suite: {
            uid: 'suite',
            title: 'conformance',
            tests: [
              { uid: 't0', title: WAITS_TEST, state: 'passed', start: 50 }
            ].map((t) => ({ ...t, start: new Date(t.start).toISOString() })),
            suites: []
          }
        }
      ]
    },
    ...commands,
    {
      scope: 'replaceCommand',
      data: { oldTimestamp: 100, command: done(1, 100, 120) }
    },
    { scope: 'commands', data: [wait(4, 130)] },
    { scope: 'commands', data: [read(5, 4, 135, '#flash')] },
    {
      scope: 'replaceCommand',
      data: { oldTimestamp: 130, command: done(4, 130, 150) }
    },
    { scope: 'commands', data: [row('click', 160, 170, { id: 6 })] }
  ].map((frame) =>
    frame.scope === 'commands'
      ? {
          ...frame,
          data: (frame.data as CommandLog[]).map((r) => ({
            ...r,
            testUid: 't0'
          }))
        }
      : frame.scope === 'replaceCommand'
        ? {
            ...frame,
            data: {
              ...(frame.data as { oldTimestamp: number; command: CommandLog }),
              command: {
                ...(frame.data as { command: CommandLog }).command,
                testUid: 't0'
              }
            }
          }
        : frame
  )
}

const report = (adapter: AdapterId, frames: WireFrame[]): RunReport => ({
  adapter,
  bidi: 'live',
  exitCode: 0,
  truth: {
    documents: [],
    failedNavigations: [],
    actions: { navigate: [], click: [], fill: [] },
    requests: [],
    bidi: 'live',
    scenarioFile: { paths: [], lines: 0 }
  },
  violations: [],
  unexplained: [],
  stale: [],
  frames,
  output: ''
})

describe('normalizeRun with nested rows', () => {
  it("nests a wait's reads under it as child steps", () => {
    const { steps } = normalizeRun(nestedRun())
    expect(
      steps.map((s) => [
        `${s.action} ${s.target}`.trim(),
        (s.children ?? []).map((c) => `${c.action} ${c.target}`)
      ])
    ).toEqual([
      [
        'Browser.waitForFunction',
        ['Element.getText #flash', 'Element.getText h2']
      ],
      ['Browser.waitForFunction', ['Element.getText #flash']],
      ['Element.click', []]
    ])
  })

  it('carries no children key on a step that issued nothing', () => {
    const { steps } = normalizeRun(nestedRun({ readParent: () => undefined }))
    expect(steps.every((s) => !('children' in s))).toBe(true)
    expect(steps).toHaveLength(6)
  })
})

describe('compareRuns with nested rows', () => {
  it('finds nothing when both adapters nest the same reads', () => {
    expect(
      compareRuns([
        report('devtools-service', nestedRun()),
        report('selenium-devtools', nestedRun())
      ])
    ).toEqual([])
  })

  it('names a read that differs inside its wait, not as a step of the test', () => {
    const divergences = compareRuns([
      report('devtools-service', nestedRun()),
      report('selenium-devtools', nestedRun({ readSelector: 'h1' }))
    ])
    expect(divergences.map((d) => [d.rule, d.message])).toEqual([
      [
        RULES.agreeOnActions,
        `devtools-service vs selenium-devtools: test "${WAITS_TEST}", Browser.waitForFunction, inside it after Element.getText #flash: devtools-service shows [Element.getText h2], selenium-devtools shows [Element.getText h1]`
      ]
    ])
  })

  it('tells nested reads from the same reads beside the wait', () => {
    const divergences = compareRuns([
      report('devtools-service', nestedRun()),
      report('selenium-devtools', nestedRun({ readParent: () => undefined }))
    ])
    expect(divergences.length).toBeGreaterThan(0)
    expect(divergences.every((d) => d.rule === RULES.agreeOnActions)).toBe(true)
  })
})

describe('checkWaitNesting', () => {
  const check = (frames: WireFrame[]) =>
    checkWaitNesting(readStream(frames)).map((v) => v.message)

  it('passes waits sent running, replaced by id, with every read naming its wait', () => {
    expect(check(nestedRun())).toEqual([])
  })

  it('flags a read that ran inside a wait but names no parent', () => {
    expect(check(nestedRun({ readParent: () => undefined }))).toEqual([
      'getText ran inside Browser.waitForFunction but names no parent',
      'getText ran inside Browser.waitForFunction but names no parent',
      'getText ran inside Browser.waitForFunction but names no parent'
    ])
  })

  it('flags a read sent before the wait it names, which a live list cannot nest on arrival', () => {
    expect(check(nestedRun({ sendWaitFirst: false }))).toEqual([
      'getText was sent before parent 1, so a live list shows it beside the wait',
      'getText was sent before parent 1, so a live list shows it beside the wait'
    ])
  })

  it('flags a wait first sent once it had ended', () => {
    const frames = nestedRun().map((frame) =>
      frame.scope === 'commands' && (frame.data as CommandLog[])[0]?.id === 4
        ? {
            ...frame,
            data: [{ ...(frame.data as CommandLog[])[0], timestamp: 150 }]
          }
        : frame
    )
    expect(check(frames)).toEqual([
      'Browser.waitForFunction is first sent once it has ended, so a live list cannot nest what it issues while it runs'
    ])
  })

  it('flags a parent no row carries', () => {
    expect(check(nestedRun({ readParent: (id) => id + 100 }))).toEqual(
      expect.arrayContaining([
        'getText names parent 101, which no row in the stream carries'
      ])
    )
  })

  it('flags a wait without the id its rows would name', () => {
    const frames = nestedRun().map((frame) =>
      frame.scope === 'replaceCommand'
        ? {
            ...frame,
            data: {
              ...(frame.data as { oldTimestamp: number; command: CommandLog }),
              command: {
                ...(frame.data as { command: CommandLog }).command,
                id: undefined
              }
            }
          }
        : frame
    )
    expect(check(frames)).toEqual(
      expect.arrayContaining([
        'Browser.waitForFunction has no id, so the rows it issued cannot be nested under it'
      ])
    )
  })

  it("flags a test whose waits are not the scenario's", () => {
    const frames = nestedRun().map((frame) =>
      frame.scope === 'suites'
        ? JSON.parse(JSON.stringify(frame).replace(WAITS_TEST, LOGIN_TEST))
        : frame
    )
    expect(check(frames)).toEqual([
      `"${LOGIN_TEST}" shows waits [Browser.waitForFunction, Browser.waitForFunction]; the scenario writes [Element.waitForExist #flash]`
    ])
  })
})

describe('the wait-row gaps', () => {
  it('declares one per adapter and mode, all pointing at #464, and goes stale once the adapter conforms', () => {
    for (const adapter of [
      'devtools-service',
      'selenium-devtools',
      'selenium-devtools-py'
    ] as AdapterId[]) {
      for (const bidi of BIDI_MODES) {
        const gaps = gapsFor(adapter, bidi).filter((g) =>
          g.rules.includes(RULES.waitParentsItsRows)
        )
        expect(gaps).toHaveLength(1)
        expect(gaps[0].reason).toContain('#464')
        expect(judge(adapter, bidi, []).stale).toContain(gaps[0])
      }
    }
  })

  it('declares none for Nightwatch, which sends a wait as one row parenting what it issued', () => {
    for (const bidi of BIDI_MODES) {
      expect(
        gapsFor('nightwatch-devtools', bidi).filter((g) =>
          g.rules.includes(RULES.waitParentsItsRows)
        )
      ).toEqual([])
    }
  })
})
