import { describe, expect, it } from 'vitest'

import type { RunnerOptions } from '@wdio/devtools-shared'

import { compareRuns, judgeDivergences } from '../src/agreement.js'
import { RULES } from '../src/constants.js'
import { normalizeRun } from '../src/normalize.js'
import { renderReport } from '../src/report-html.js'
import type {
  AdapterId,
  BidiMode,
  RunReport,
  Violation,
  WireFrame
} from '../src/types.js'

const anchor = (url: string, timestamp: number) => ({
  type: 'childList',
  url,
  timestamp,
  addedNodes: [],
  removedNodes: []
})

interface Dialect {
  navigate: string
  fill: string
  fillArgs: (text: string) => unknown[]
}

/** JS passes the text bare; Python the W3C payload its binding built; Nightwatch leads with the selector. */
const JS: Dialect = { navigate: 'get', fill: 'sendKeys', fillArgs: (t) => [t] }
const PY: Dialect = {
  navigate: 'get',
  fill: 'sendKeysToElement',
  fillArgs: (t) => [{ text: t, value: [...t], id: 'el-1' }]
}
const NW: Dialect = {
  navigate: 'url',
  fill: 'setValue',
  fillArgs: (t) => ['#username', t]
}

const RUN_ALL: RunnerOptions = {
  runCapabilities: { canRunAll: true },
  launchCommand: 'run'
}
const EVERY_CONTROL: RunnerOptions = {
  runCapabilities: { canRunAll: true, canRunSuites: true, canRunTests: true },
  launchCommand: 'run'
}

interface Variant {
  error?: string
  text?: string
  /** Pages anchored, as [path, timestamp]. */
  anchors?: [string, number][]
  options?: RunnerOptions
  /** Paths the Network tab lists, as the page's Resource Timing rows. */
  requests?: string[]
}

/** One adapter's stream for: navigate to /login, type into #username. */
function stream(
  port: number,
  dialect: Dialect,
  {
    error,
    text = 'tom',
    anchors = [['/login', 10]],
    options = RUN_ALL,
    requests = ['/login']
  }: Variant = {}
): WireFrame[] {
  const url = (path: string) => `http://127.0.0.1:${port}${path}`
  return [
    { scope: 'metadata', data: { type: 'testrunner', options } },
    {
      scope: 'commands',
      data: [
        {
          command: dialect.navigate,
          args: [url('/login')],
          startTime: 0,
          timestamp: 20
        },
        {
          command: dialect.fill,
          args: dialect.fillArgs(text),
          selector: '#username',
          startTime: 30,
          timestamp: 40,
          ...(error ? { error: { name: 'Error', message: error } } : {})
        }
      ]
    },
    { scope: 'mutations', data: anchors.map(([p, ts]) => anchor(url(p), ts)) },
    {
      scope: 'networkRequests',
      data: requests.map((path, i) => ({
        id: `rt-${i}`,
        url: url(path),
        method: '',
        type: 'document',
        timestamp: 5,
        startTime: 0,
        source: 'resource-timing'
      }))
    }
  ]
}

const report = (
  adapter: AdapterId,
  frames: WireFrame[],
  bidi: BidiMode = 'live',
  violations: Violation[] = []
): RunReport => ({
  adapter,
  bidi,
  exitCode: 0,
  truth: {
    documents: [],
    failedNavigations: [],
    actions: { navigate: [], click: [], fill: [] },
    requests: [],
    bidi
  },
  violations,
  unexplained: [],
  stale: [],
  frames,
  output: ''
})

/** What the JS no-BiDi gap produces for this stream when nothing is anchored. */
const wrongPage = (timestamp: number): Violation => ({
  rule: RULES.rowReplaysPage,
  message: 'replays no document',
  subject: { kind: 'row', timestamp }
})
/** What the JS no-BiDi gap produces when a page's loads die undrained with it. */
const withheld = (port: number, path: string): Violation => ({
  rule: RULES.requestListed,
  message: `${path}: the browser made 1 request(s), the stream lists 0 row(s)`,
  subject: {
    kind: 'request',
    timestamp: 0,
    url: `http://127.0.0.1:${port}${path}`,
    rows: 0,
    made: 1
  }
})
const unanchored = (port: number, path: string): Violation => ({
  rule: RULES.documentAnchored,
  message: `document ${path} has no anchor`,
  subject: {
    kind: 'document',
    timestamp: 10,
    url: `http://127.0.0.1:${port}${path}`
  }
})

describe('normalizeRun', () => {
  it("reduces each adapter's command names, payloads and ports to what a user sees", () => {
    expect(normalizeRun(stream(1111, JS))).toEqual(
      normalizeRun(stream(2222, PY))
    )
    expect(normalizeRun(stream(1111, JS)).steps[1]).toEqual({
      action: 'Element.fill',
      target: '#username',
      input: 'tom',
      outcome: 'ok',
      page: '/login',
      at: 40
    })
  })

  // Regression: the text was whatever argument differed from the selector, so typing the selector lost it.
  it('reads the text a Nightwatch fill typed, even when it equals the selector', () => {
    expect(normalizeRun(stream(1, NW))).toEqual(normalizeRun(stream(2, JS)))
    const typedSelector = { text: '#username' }
    expect(normalizeRun(stream(1, NW, typedSelector)).steps[1].input).toBe(
      '#username'
    )
    expect(normalizeRun(stream(1, NW, typedSelector))).toEqual(
      normalizeRun(stream(2, PY, typedSelector))
    )
  })
})

describe('compareRuns', () => {
  it('finds nothing when the adapters tell the same story', () => {
    expect(
      compareRuns([
        report('selenium-devtools', stream(1, JS)),
        report('selenium-devtools-py', stream(2, PY))
      ])
    ).toEqual([])
  })

  it('flags a fill whose typed text differs, with no rule written for that field', () => {
    const divergences = compareRuns([
      report('selenium-devtools', stream(1, JS)),
      report('selenium-devtools-py', stream(2, PY, { text: 'wrong' }))
    ])
    expect(divergences.map((d) => d.rule)).toEqual([RULES.agreeOnActions])
    expect(divergences[0].message).toContain('types "tom" vs "wrong"')
  })

  it('flags a step that fails with different text', () => {
    const divergences = compareRuns([
      report('selenium-devtools', stream(1, JS, { error: 'net::ERR_FAILED' })),
      report(
        'selenium-devtools-py',
        stream(2, PY, { error: 'Message: net::ERR_FAILED' })
      )
    ])
    expect(divergences.map((d) => d.rule)).toEqual([RULES.agreeOnErrors])
  })

  it('flags a step one adapter never reported', () => {
    const missing = stream(2, PY)
    missing[1] = {
      scope: 'commands',
      data: (missing[1].data as unknown[]).slice(0, 1)
    }
    const divergences = compareRuns([
      report('selenium-devtools', stream(1, JS)),
      report('selenium-devtools-py', missing)
    ])
    expect(divergences.map((d) => d.rule)).toEqual([RULES.agreeOnActions])
  })

  it('flags different pages and snapshots', () => {
    const rules = compareRuns([
      report('selenium-devtools', stream(1, JS)),
      report('selenium-devtools-py', stream(2, PY, { anchors: [] }))
    ]).map((d) => d.rule)
    expect(rules).toEqual([
      RULES.agreeOnPages,
      RULES.agreeOnPages,
      RULES.agreeOnSnapshots
    ])
  })
})

describe('judgeDivergences', () => {
  const jsGap = (port: number) => [
    wrongPage(20),
    wrongPage(40),
    unanchored(port, '/login')
  ]

  it("excuses a difference where the holder's own run shows its gap", () => {
    const js = report(
      'selenium-devtools',
      stream(1, JS, { anchors: [] }),
      'off',
      jsGap(1)
    )
    const py = report('selenium-devtools-py', stream(2, PY), 'off')
    const { unexplained } = judgeDivergences(compareRuns([js, py]), [js, py])
    expect(unexplained).toEqual([])
  })

  // The reviewer's case: JS misses its anchors while Python stamps the fill after a later navigation.
  it('does not excuse the other adapter being wrong at the same step', () => {
    const js = report(
      'selenium-devtools',
      stream(1, JS, { anchors: [] }),
      'off',
      [...jsGap(1), unanchored(1, '/secure')]
    )
    const py = report(
      'selenium-devtools-py',
      stream(2, PY, {
        anchors: [
          ['/login', 10],
          ['/secure', 35]
        ]
      }),
      'off',
      [wrongPage(40)]
    )
    const { unexplained } = judgeDivergences(compareRuns([js, py]), [js, py])
    expect(unexplained.map((d) => d.rule)).toEqual([RULES.agreeOnPages])
    expect(unexplained[0].message).toContain('step 2')
  })

  // Regression: a gap excused any matching difference, so it masked the OTHER adapter regressing.
  it('does not excuse a difference when the gap is not occurring', () => {
    const js = report('selenium-devtools', stream(1, JS), 'off')
    const py = report(
      'selenium-devtools-py',
      stream(2, PY, { anchors: [] }),
      'off'
    )
    const { unexplained } = judgeDivergences(compareRuns([js, py]), [js, py])
    expect(unexplained.map((d) => d.rule)).toContain(RULES.agreeOnSnapshots)
  })

  it("excuses a missing request where the holder's own run shows the load withheld", () => {
    const js = report(
      'selenium-devtools',
      stream(1, JS, { requests: [] }),
      'off',
      [withheld(1, '/login')]
    )
    const py = report('selenium-devtools-py', stream(2, PY), 'off')
    const { unexplained } = judgeDivergences(compareRuns([js, py]), [js, py])
    expect(unexplained).toEqual([])
  })

  // The holder's gap covers a load it withheld, never a load the other adapter listed twice.
  it('does not excuse a request the other adapter listed twice', () => {
    const js = report('selenium-devtools', stream(1, JS), 'off')
    const py = report(
      'selenium-devtools-py',
      stream(2, PY, { requests: ['/login', '/login'] }),
      'off',
      [
        {
          rule: RULES.requestListedOnce,
          message:
            '/login: the browser made 1 request(s), the stream lists 2 row(s)',
          subject: {
            kind: 'request',
            timestamp: 0,
            url: 'http://127.0.0.1:2/login',
            rows: 2,
            made: 1
          }
        }
      ]
    )
    const { unexplained } = judgeDivergences(compareRuns([js, py]), [js, py])
    expect(unexplained.map((d) => d.rule)).toEqual([RULES.agreeOnRequests])
  })

  it('does not excuse a difference in a mode the gap does not cover', () => {
    const js = report(
      'selenium-devtools',
      stream(1, JS, { anchors: [] }),
      'live',
      jsGap(1)
    )
    const py = report('selenium-devtools-py', stream(2, PY), 'live')
    const { unexplained } = judgeDivergences(compareRuns([js, py]), [js, py])
    expect(unexplained).toHaveLength(3)
  })

  /** Nightwatch, served by its config file, against Selenium offering every control. */
  const nightwatchAgainstSelenium = (
    runCapabilities: RunnerOptions['runCapabilities']
  ) => {
    const options = { runCapabilities, configFile: 'nightwatch.conf.cjs' }
    const nw = report('nightwatch-devtools', stream(1, NW, { options }))
    const js = report(
      'selenium-devtools',
      stream(2, JS, { options: EVERY_CONTROL })
    )
    return judgeDivergences(compareRuns([nw, js]), [nw, js])
  }

  it('excuses only the run control the gap declares absent', () => {
    const { unexplained, explained, stale } = nightwatchAgainstSelenium({
      canRunAll: false,
      canRunSuites: true,
      canRunTests: true
    })
    expect(unexplained).toEqual([])
    expect(explained.map((d) => d.rule)).toEqual([RULES.agreeOnRunControls])
    expect(stale).toEqual([])
  })

  // Regression: any run-controls difference was explained once Nightwatch held its gap, so a lost control passed.
  it('does not excuse a run control the holder lost since declaring its gap', () => {
    const { unexplained } = nightwatchAgainstSelenium({
      canRunAll: false,
      canRunSuites: true,
      canRunTests: false
    })
    expect(unexplained.map((d) => d.rule)).toEqual([RULES.agreeOnRunControls])
    expect(unexplained[0].message).toContain(
      'canRunSuites; served vs canRunAll, canRunSuites, canRunTests; served'
    )
  })

  it('reports a comparison gap that no longer occurs as stale', () => {
    const { unexplained, stale } = nightwatchAgainstSelenium(
      EVERY_CONTROL.runCapabilities
    )
    expect(unexplained).toEqual([])
    expect(stale.map((g) => g.adapter)).toEqual(['nightwatch-devtools'])
  })
})

describe('the agreement section of the report', () => {
  it('marks a mode where adapters diverge, and highlights the differing row', () => {
    const html = renderReport([
      report('selenium-devtools', stream(1, JS, { error: 'net::ERR_FAILED' })),
      report(
        'selenium-devtools-py',
        stream(2, PY, { error: 'Message: net::ERR_FAILED' })
      )
    ])
    expect(html).toContain('Do the adapters agree?')
    expect(html).toContain('DIVERGE')
    expect(html).not.toContain('KNOWN DIFFERENCES')
    expect(html).toContain('class="differs"')
  })

  // Regression: the comparison's stale gaps never reached the report, which read AGREE while the test failed.
  it('shows a stale comparison gap instead of calling the mode agreed', () => {
    const html = renderReport([
      report('nightwatch-devtools', stream(1, NW, { options: EVERY_CONTROL })),
      report('selenium-devtools', stream(2, JS, { options: EVERY_CONTROL }))
    ])
    expect(html).toContain('STALE GAPS (1)')
    expect(html).toContain(
      'Stale gap</strong> for <code>nightwatch-devtools</code>'
    )
    expect(html).not.toContain('>AGREE<')
  })
})

describe('normalizeRun on the WDIO service shape', () => {
  // The service also leads a fill's args with the selector; the text is still the last argument.
  it('reads the text a fill ends with, whatever leads', () => {
    const run = normalizeRun([
      {
        scope: 'commands',
        data: [
          {
            command: 'setValue',
            args: ['#username', 'tom'],
            selector: '#username',
            startTime: 30,
            timestamp: 40
          }
        ]
      }
    ])
    expect(run.steps[0]).toMatchObject({
      action: 'Element.fill',
      target: '#username',
      input: 'tom'
    })
  })
})
