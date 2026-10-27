import { describe, expect, it } from 'vitest'

import { checkConformance } from '../src/checker.js'
import { RULES } from '../src/constants.js'
import type { GroundTruth, WireFrame } from '../src/types.js'

const LOGIN = 'http://fake/login'
const SECURE = 'http://fake/secure'
const BROKEN = 'http://fake/broken'

const APP_JS = 'http://fake/app.js'
const APP_CSS = 'http://fake/app.css'

/** Each document loads itself and the two subresources. */
const loads = (document: string, at: number) =>
  [document, APP_JS, APP_CSS].map((url) => ({ url, document, at }))

const truth: GroundTruth = {
  documents: [
    { url: LOGIN, bornAt: 100 },
    { url: SECURE, bornAt: 300 }
  ],
  failedNavigations: [{ url: BROKEN, message: 'net::ERR_FAILED at /broken' }],
  actions: { navigate: [110, 340, 360], click: [320], fill: [] },
  requests: [...loads(LOGIN, 100), ...loads(SECURE, 300)],
  bidi: 'off'
}

/** A load as the page's Resource Timing lists it: no status, no headers, its source marked. */
const resourceTimingRow = (id: string, url: string, timestamp: number) => ({
  id,
  url,
  method: 'GET',
  type: 'script',
  timestamp,
  startTime: 0,
  source: 'resource-timing'
})

/** The same load as BiDi reports it: a status and the response headers. */
const servedRow = (id: string, url: string, timestamp: number) => ({
  id,
  url,
  method: 'GET',
  type: 'script',
  timestamp,
  startTime: 0,
  status: 200,
  responseHeaders: { 'content-type': 'text/javascript' }
})

const pageRows = () => [
  ...[LOGIN, APP_JS, APP_CSS].map((url, i) =>
    resourceTimingRow(`rt-1-${i}`, url, 100)
  ),
  ...[SECURE, APP_JS, APP_CSS].map((url, i) =>
    resourceTimingRow(`rt-2-${i}`, url, 300)
  )
]

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
    {
      scope: 'metadata',
      data: {
        type: 'testrunner',
        options: { launchCommand: 'node scenario.js' }
      }
    },
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
    },
    { scope: 'networkRequests', data: pageRows() }
  ]
}

const rules = (frames: WireFrame[]) =>
  checkConformance(frames, truth).map((v) => v.rule)

describe('checkConformance', () => {
  it('passes a stream that follows every rule', () => {
    expect(checkConformance(conformingStream(), truth)).toEqual([])
  })

  it('flags a load the browser made that the stream never lists', () => {
    // The Safari and Appium failure: the page's rows withheld because a BiDi subscription counted as a source.
    const frames = conformingStream().slice(0, -1)
    frames.push({ scope: 'networkRequests', data: pageRows().slice(1) })
    expect(checkConformance(frames, truth)).toEqual([
      expect.objectContaining({
        rule: RULES.requestListed,
        subject: expect.objectContaining({ kind: 'request', rows: 0, made: 1 })
      })
    ])
  })

  it('flags a load listed twice, whichever sources listed it', () => {
    const frames = conformingStream()
    frames.push({
      scope: 'networkRequests',
      data: [resourceTimingRow('rt-again', APP_JS, 100)]
    })
    expect(rules(frames)).toEqual([RULES.requestListedOnce])
  })

  it('appends rows without an id rather than folding them, as the dashboard does', () => {
    const frames = conformingStream()
    frames.push({
      scope: 'networkRequests',
      data: [
        resourceTimingRow('', APP_JS, 100),
        resourceTimingRow('', APP_JS, 100)
      ]
    })
    expect(checkConformance(frames, truth)).toEqual([
      expect.objectContaining({
        rule: RULES.requestListedOnce,
        subject: expect.objectContaining({ rows: 4, made: 2 })
      })
    ])
  })

  it('reports a network row without url and id rather than judging it', () => {
    const frames = conformingStream()
    frames.push({ scope: 'networkRequests', data: [{ id: 'x' }] })
    expect(() => checkConformance(frames, truth)).toThrow(/without url and id/)
  })

  it('without BiDi, accepts a row carrying the status and headers the page’s fetch patch supplies', () => {
    const frames = conformingStream().slice(0, -1)
    frames.push({
      scope: 'networkRequests',
      data: [
        ...pageRows().slice(1),
        {
          ...pageRows()[0],
          source: undefined,
          status: 200,
          responseHeaders: { 'content-type': 'text/html' }
        }
      ]
    })
    expect(rules(frames)).toEqual([])
  })

  it('counts a row re-sent under its own id once, as the dashboard shows it', () => {
    const frames = conformingStream()
    frames.push({
      scope: 'networkRequests',
      data: [{ ...resourceTimingRow('rt-1-1', APP_JS, 100), size: 900 }]
    })
    expect(rules(frames)).toEqual([])
  })

  it('flags a row that passes as a driver’s when nothing but the page could have served it', () => {
    const frames = conformingStream().slice(0, -1)
    frames.push({
      scope: 'networkRequests',
      data: [...pageRows().slice(1), { ...pageRows()[0], source: undefined }]
    })
    expect(rules(frames)).toEqual([RULES.requestSourceServed])
  })

  it('with BiDi live, flags rows that carry less than the driver served', () => {
    // The page's rows passed through although BiDi reported every load with a status and headers.
    const live = { ...truth, bidi: 'live' as const }
    expect(
      checkConformance(conformingStream(), live).map((v) => v.rule)
    ).toEqual(Array(6).fill(RULES.requestSourceServed))
    const frames = conformingStream().slice(0, -1)
    frames.push({
      scope: 'networkRequests',
      data: [
        ...[LOGIN, APP_JS, APP_CSS].map((url, i) =>
          servedRow(`r-1-${i}`, url, 100)
        ),
        ...[SECURE, APP_JS, APP_CSS].map((url, i) =>
          servedRow(`r-2-${i}`, url, 300)
        )
      ]
    })
    expect(checkConformance(frames, live)).toEqual([])
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

  // Regression: a wait's later poll replaced its row under a new stamp, and the next poll's replace was flagged.
  it('accepts a replaceCommand naming the stamp an earlier replacement gave its row', () => {
    const poll = (timestamp: number) => row('findElements', [], 0, timestamp)
    const frames = [
      ...conformingStream(),
      { scope: 'commands', data: [poll(370)] },
      {
        scope: 'replaceCommand',
        data: { oldTimestamp: 370, command: poll(380) }
      },
      {
        scope: 'replaceCommand',
        data: { oldTimestamp: 380, command: poll(390) }
      }
    ]
    expect(rules(frames)).toEqual([])
  })

  it('flags a replaceCommand naming a stamp its row has since given up', () => {
    const poll = (timestamp: number) => row('findElements', [], 0, timestamp)
    const frames = [
      ...conformingStream(),
      { scope: 'commands', data: [poll(370)] },
      {
        scope: 'replaceCommand',
        data: { oldTimestamp: 370, command: poll(380) }
      },
      {
        scope: 'replaceCommand',
        data: { oldTimestamp: 370, command: poll(390) }
      }
    ]
    expect(rules(frames)).toEqual([RULES.replaceTargetsRow])
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

  it('flags run controls advertised with nothing to serve them', () => {
    const frames = conformingStream()
    frames[0] = {
      scope: 'metadata',
      data: {
        type: 'testrunner',
        options: { runCapabilities: { canRunAll: true, canRunTests: false } }
      }
    }
    expect(rules(frames)).toEqual([RULES.runControlsServed])
  })

  // The dashboard offers every control unless told otherwise, so silence advertises all of them.
  it('flags a stream that declares no capabilities and serves nothing', () => {
    const frames = conformingStream()
    frames[0] = { scope: 'metadata', data: { type: 'testrunner' } }
    expect(rules(frames)).toEqual([RULES.runControlsServed])
  })

  it('accepts a config frame as what serves the controls, as the WDIO service sends it', () => {
    const frames = conformingStream()
    frames[0] = { scope: 'metadata', data: { type: 'testrunner' } }
    frames.push({
      scope: 'config',
      data: { configFile: '/project/wdio.conf.ts' }
    })
    expect(checkConformance(frames, truth)).toEqual([])
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

  it('flags a navigation row naming a page the browser did not load', () => {
    const frames = conformingStream()
    frames[5] = {
      scope: 'commands',
      data: [row('get', [{ url: 'http://fake/other' }], 330, 340)]
    }
    expect(rules(frames)).toEqual([RULES.navigationNamesDestination])
  })

  // The checker throws rather than guessing, and the harness keeps the frames beside the error.
  it('refuses a row without the fields every rule reads', () => {
    const frames = [
      ...conformingStream(),
      {
        scope: 'commands',
        data: [{ command: 'sendKeys', args: {}, timestamp: 400 }]
      }
    ]
    expect(() => checkConformance(frames, truth)).toThrow(/args/)
  })

  // Regression: an Error sent raw reaches the socket as `{}`, and the normaliser crashed on it.
  it('refuses a failed row whose error carries no message', () => {
    const frames = [
      ...conformingStream(),
      {
        scope: 'commands',
        data: [{ command: 'url', args: ['/broken'], timestamp: 400, error: {} }]
      }
    ]
    expect(() => checkConformance(frames, truth)).toThrow(/message/)
  })
})
