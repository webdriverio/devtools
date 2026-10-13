import { describe, expect, it } from 'vitest'

import { checkConformance } from '../src/checker.js'
import { RULES } from '../src/constants.js'
import type { GroundTruth, WireFrame } from '../src/types.js'

const LOGIN = 'http://fake/login'
const SECURE = 'http://fake/secure'
const BROKEN = 'http://fake/broken'

const truth: GroundTruth = {
  documents: [
    { url: LOGIN, bornAt: 100 },
    { url: SECURE, bornAt: 300 }
  ],
  failedNavigations: [{ url: BROKEN, message: 'net::ERR_FAILED at /broken' }],
  actions: { navigate: [110, 340, 360], click: [320], fill: [] }
}

const anchor = (url: string, timestamp: number) => ({
  type: 'childList',
  url,
  timestamp,
  addedNodes: [],
  removedNodes: []
})

const row = (
  command: string,
  args: unknown[],
  startTime: number,
  timestamp: number,
  extra = {}
) => ({
  command,
  args,
  startTime,
  timestamp,
  ...extra
})

function conformingStream(): WireFrame[] {
  return [
    { scope: 'metadata', data: { type: 'testrunner' } },
    { scope: 'commands', data: [row('get', [LOGIN], 90, 110)] },
    { scope: 'mutations', data: [anchor(LOGIN, 100)] },
    { scope: 'commands', data: [row('click', [], 200, 320)] },
    { scope: 'mutations', data: [anchor(SECURE, 300)] },
    { scope: 'commands', data: [row('get', [{ url: SECURE }], 330, 340)] },
    {
      scope: 'commands',
      data: [
        row('get', [BROKEN], 350, 360, {
          error: { name: 'Error', message: 'net::ERR_FAILED at /broken' }
        })
      ]
    },
    {
      scope: 'replaceCommand',
      data: { oldTimestamp: 110, command: row('get', [LOGIN], 90, 110) }
    }
  ]
}

const rules = (frames: WireFrame[]) =>
  checkConformance(frames, truth).map((v) => v.rule)

describe('checkConformance', () => {
  it('passes a stream that follows every rule', () => {
    expect(checkConformance(conformingStream(), truth)).toEqual([])
  })

  it('flags commands sent before any metadata', () => {
    expect(rules(conformingStream().slice(1))).toEqual([RULES.metadataFirst])
  })

  it('flags a row that ends before it starts', () => {
    const frames = conformingStream()
    frames[3] = { scope: 'commands', data: [row('click', [], 330, 320)] }
    expect(rules(frames)).toEqual([RULES.completionStamp])
  })

  it('flags a navigation stamped at invocation, which replays the previous page', () => {
    const frames = conformingStream()
    frames[5] = { scope: 'commands', data: [row('get', [SECURE], 290, 290)] }
    expect(rules(frames)).toEqual(
      expect.arrayContaining([RULES.rowReplaysPage, RULES.completionStamp])
    )
  })

  it('flags a document that never got an anchor', () => {
    const frames = conformingStream().filter(
      (f) =>
        !(f.scope === 'mutations' && JSON.stringify(f.data).includes(SECURE))
    )
    expect(rules(frames)).toContain(RULES.documentAnchored)
  })

  it('flags a document anchored twice', () => {
    const frames = [
      ...conformingStream(),
      { scope: 'mutations', data: [anchor(SECURE, 300)] }
    ]
    expect(rules(frames)).toEqual([RULES.anchorOnce])
  })

  it('flags an anchor stamped after its document was born', () => {
    const frames = conformingStream()
    frames[2] = { scope: 'mutations', data: [anchor(LOGIN, 150)] }
    expect(rules(frames)).toContain(RULES.anchorBirthTime)
  })

  it('flags a failed navigation with no error row', () => {
    const frames = conformingStream().filter(
      (f) => !JSON.stringify(f.data).includes(BROKEN)
    )
    expect(rules(frames)).toContain(RULES.failureRecorded)
  })

  it('flags a replaceCommand naming a row never sent', () => {
    const frames = [
      ...conformingStream(),
      {
        scope: 'replaceCommand',
        data: { oldTimestamp: 999, command: row('get', [], 0, 999) }
      }
    ]
    expect(rules(frames)).toContain(RULES.replaceTargetsRow)
  })

  it('flags a row the browser saw but the stream lost', () => {
    const frames = conformingStream().filter(
      (f) => !JSON.stringify(f.data).includes('"click"')
    )
    expect(rules(frames)).toEqual([RULES.rowPerAction])
  })

  it('flags a duplicated row', () => {
    const frames = [
      ...conformingStream(),
      { scope: 'commands', data: [row('click', [], 400, 410)] }
    ]
    expect(rules(frames)).toEqual([RULES.rowPerAction])
  })

  // Regression: a replacement matched by timestamp alone overwrote a row that finished in the same ms.
  it('applies a replacement to the row with its id, not the first at that timestamp', () => {
    const frames: WireFrame[] = [
      ...conformingStream(),
      {
        scope: 'commands',
        data: [
          row('sendKeys', ['x'], 410, 420, { id: 7 }),
          row('click', [], 415, 420, { id: 8 })
        ]
      },
      {
        scope: 'replaceCommand',
        data: {
          oldTimestamp: 420,
          command: row('click', [], 415, 420, { id: 8 })
        }
      }
    ]
    const withTwoMore = {
      ...truth,
      actions: { navigate: [110, 340, 360], click: [320, 420], fill: [420] }
    }
    expect(checkConformance(frames, withTwoMore)).toEqual([])
  })

  it('flags run controls advertised with no command behind them', () => {
    const frames = conformingStream()
    frames[0] = {
      scope: 'metadata',
      data: {
        type: 'testrunner',
        options: { runCapabilities: { canRunAll: true, canRunTests: false } }
      }
    }
    expect(rules(frames)).toEqual([RULES.runControlsHaveCommand])
  })

  it('accepts run controls served by either command, as the backend falls back between them', () => {
    const frames = conformingStream()
    frames[0] = {
      scope: 'metadata',
      data: {
        type: 'testrunner',
        options: {
          runCapabilities: { canRunAll: true, canRunTests: true },
          launchCommand: 'node script.js'
        }
      }
    }
    expect(checkConformance(frames, truth)).toEqual([])
  })

  it("flags an error row whose message is the binding's formatting, not the browser's", () => {
    const frames = conformingStream().map((f) =>
      JSON.stringify(f.data).includes(BROKEN) && f.scope === 'commands'
        ? {
            scope: 'commands',
            data: [
              row('get', [BROKEN], 350, 360, {
                error: {
                  name: 'WebDriverException',
                  message:
                    'Message: net::ERR_FAILED at /broken\nStacktrace:\n#0 0x55d0 <unknown>\n'
                }
              })
            ]
          }
        : f
    )
    expect(rules(frames)).toEqual([RULES.errorCarriesBrowserMessage])
  })

  it('flags a click stamped before the browser completed it', () => {
    const frames = conformingStream()
    frames[3] = { scope: 'commands', data: [row('click', [], 200, 200)] }
    expect(rules(frames)).toContain(RULES.completionStamp)
  })

  it('flags typing stamped before the browser completed it', () => {
    const frames = [
      ...conformingStream(),
      { scope: 'commands', data: [row('sendKeys', ['x'], 400, 400)] }
    ]
    const typed = { ...truth, actions: { ...truth.actions, fill: [410] } }
    expect(checkConformance(frames, typed).map((v) => v.rule)).toEqual([
      RULES.completionStamp
    ])
  })

  it('accepts a row stamped in the same millisecond its action completed', () => {
    const frames = [
      ...conformingStream(),
      { scope: 'commands', data: [row('sendKeys', ['x'], 410, 410)] }
    ]
    const typed = { ...truth, actions: { ...truth.actions, fill: [410] } }
    expect(checkConformance(frames, typed)).toEqual([])
  })

  it('flags an anchor stamped before its document was born', () => {
    const frames = conformingStream()
    frames[2] = { scope: 'mutations', data: [anchor(LOGIN, 99)] }
    expect(rules(frames)).toContain(RULES.anchorBirthTime)
  })

  // The reviewer's case: a fill stamped after a later navigation replays that page, with its timestamps consistent.
  it('flags a row stamped after a later navigation, which replays a page the browser was not on', () => {
    const frames = [
      ...conformingStream(),
      { scope: 'commands', data: [row('sendKeys', ['x'], 240, 310)] }
    ]
    const typed = { ...truth, actions: { ...truth.actions, fill: [250] } }
    expect(checkConformance(frames, typed).map((v) => v.rule)).toEqual([
      RULES.rowReplaysPage
    ])
  })
})
