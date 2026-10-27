import { describe, expect, it } from 'vitest'

import type { RunnerOptions } from '@wdio/devtools-shared'

import { compareRuns, judgeDivergences } from '../src/agreement.js'
import { covers, declaresLacks, KNOWN_GAPS } from '../src/allowlist.js'
import { KNOWN_DEBT, RULES, SCENARIO_TESTS } from '../src/constants.js'
import { moved } from '../src/gap-matchers.js'
import { normalizeRun } from '../src/normalize.js'
import { scenarioIndex } from '../src/scenario-tests.js'
import { renderReport } from '../src/report-html.js'
import type {
  AdapterId,
  BidiMode,
  KnownGap,
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
  /** Rows after the fill, each one stamped 10 ms after the last. */
  more?: Record<string, unknown>[]
  /** The tests the suites frame reports, as [title, start ms]. */
  tests?: [string, number][]
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
    requests = ['/login'],
    more = [],
    tests = []
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
        },
        ...more.map((row, i) => ({
          args: [],
          startTime: 45 + i * 10,
          timestamp: 50 + i * 10,
          ...row
        }))
      ]
    },
    { scope: 'mutations', data: anchors.map(([p, ts]) => anchor(url(p), ts)) },
    {
      scope: 'suites',
      data: [
        {
          suite: {
            uid: 'suite',
            title: 'conformance',
            tests: tests.map(([title, start], i) => ({
              uid: `t${i}`,
              title,
              state: 'passed',
              start: new Date(start).toISOString()
            })),
            suites: []
          }
        }
      ]
    },
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
    bidi,
    scenarioFile: { paths: [], lines: 0 }
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
      at: 40,
      test: -1
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
    expect(divergences[0].message).toContain(
      'selenium-devtools types "tom", selenium-devtools-py types "wrong"'
    )
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
    expect(unexplained[0].message).toContain('Element.fill #username: ')
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
    expect(
      unexplained.filter((d) => d.rule === RULES.agreeOnPages)
    ).toHaveLength(2)
  })

  /** Nightwatch, served by its config file, against the WDIO service offering every control. */
  const nightwatchAgainstService = (
    runCapabilities: RunnerOptions['runCapabilities']
  ) => {
    const options = { runCapabilities, configFile: 'nightwatch.conf.cjs' }
    const nw = report('nightwatch-devtools', stream(1, NW, { options }))
    const js = report(
      'devtools-service',
      stream(2, JS, { options: EVERY_CONTROL })
    )
    const judged = judgeDivergences(compareRuns([nw, js]), [nw, js])
    // The scenario's gaps have nothing to match in this stream; only run-controls staleness is under test.
    const stale = judged.stale.filter((g) =>
      g.rules.includes(RULES.agreeOnRunControls)
    )
    return { ...judged, stale }
  }

  it('finds no run-controls difference now that Nightwatch offers every control', () => {
    const { unexplained, explained, stale } = nightwatchAgainstService(
      EVERY_CONTROL.runCapabilities
    )
    expect([...unexplained, ...explained]).toEqual([])
    expect(stale).toEqual([])
  })

  it('reports a run control one adapter does not offer as unexplained', () => {
    const { unexplained } = nightwatchAgainstService({
      canRunAll: false,
      canRunSuites: true,
      canRunTests: true
    })
    expect(unexplained.map((d) => d.rule)).toEqual([RULES.agreeOnRunControls])
    expect(unexplained[0].message).toContain(
      'canRunAll, canRunSuites, canRunTests; served vs canRunSuites, canRunTests; served'
    )
  })
})

describe('a gap that declares what its holder lacks', () => {
  const wait = { command: 'waitForExist', selector: '#flash' }
  const assertion = (selector?: string) => ({
    command: 'assert.equal',
    args: ['a', 'a'],
    ...(selector ? { selector } : {})
  })
  const service = () =>
    report(
      'devtools-service',
      stream(1, JS, { more: [wait, assertion('#flash')] })
    )

  it('drops the lacked step and target from both sides and compares the rest', () => {
    const py = report(
      'selenium-devtools-py',
      stream(2, PY, { more: [assertion()] })
    )
    const runs = [service(), py]
    expect(compareRuns(runs)).toEqual([])
    expect(judgeDivergences([], runs).stale.filter(declaresLacks)).toEqual([])
  })

  it('excuses nothing else: a difference past the lacked step still fails', () => {
    const py = report(
      'selenium-devtools-py',
      stream(2, PY, { more: [{ ...assertion(), command: 'assert.notEqual' }] })
    )
    const runs = [service(), py]
    const { unexplained } = judgeDivergences(compareRuns(runs), runs)
    expect(unexplained.map((d) => d.rule)).toEqual([RULES.agreeOnActions])
    expect(unexplained[0].message).toContain('Assert.notEqual')
  })

  it('goes stale once the holder shows the step it declared lacking', () => {
    const py = report(
      'selenium-devtools-py',
      stream(2, PY, { more: [wait, assertion()] })
    )
    const { stale } = judgeDivergences([], [service(), py])
    expect(stale.filter(declaresLacks).map((g) => g.lacksSteps)).toEqual([
      ['Element.waitForExist #flash']
    ])
  })
})

describe('covers', () => {
  const gap = {
    adapter: 'nightwatch-devtools' as const,
    bidi: 'live' as const,
    rules: [RULES.agreeOnActions],
    reason: ''
  }
  const at = (message: string): Violation => ({
    rule: RULES.agreeOnActions,
    message
  })

  it('narrows a gap to the divergence its `only` names', () => {
    const scoped = { ...gap, only: (m: string) => m.startsWith('step 5 is') }
    expect(covers(scoped, at('step 5 is A vs B'))).toBe(true)
    expect(covers(scoped, at('step 6 is A vs B'))).toBe(false)
    expect(covers(gap, at('step 6 is A vs B'))).toBe(true)
  })

  it('never lets a gap that declares a lack excuse a divergence', () => {
    expect(
      covers({ ...gap, lacksSteps: ['Element.waitForExist'] }, at('step 1'))
    ).toBe(false)
  })
})

describe('comparing past a difference', () => {
  const failed = { name: 'AssertionError', message: 'x' }

  it('still reports a later outcome difference after an excused one', () => {
    const js = report(
      'devtools-service',
      stream(1, JS, {
        more: [
          { command: 'waitForExist', selector: '#flash' },
          { command: 'assert.equal' }
        ]
      })
    )
    const py = report(
      'selenium-devtools-py',
      stream(2, PY, { more: [{ command: 'assert.equal', error: failed }] })
    )
    const runs = [js, py]
    const { unexplained } = judgeDivergences(compareRuns(runs), runs)
    expect(unexplained.map((d) => d.rule)).toEqual([RULES.agreeOnErrors])
    expect(unexplained[0].message).toContain(
      'Assert.equal: devtools-service ok, selenium-devtools-py failed'
    )
  })

  it('reports a missing step as its own difference and still compares every step after it', () => {
    const js = report(
      'devtools-service',
      stream(1, JS, {
        more: [
          { command: 'getText', selector: 'h2' },
          { command: 'assert.equal' }
        ]
      })
    )
    const nw = report(
      'nightwatch-devtools',
      stream(2, NW, { more: [{ command: 'assert.equal', error: failed }] })
    )
    const divergences = compareRuns([js, nw])
    expect(divergences.map((d) => d.rule)).toEqual([
      RULES.agreeOnActions,
      RULES.agreeOnErrors
    ])
    expect(divergences[0].message).toContain(
      'after Element.fill #username: devtools-service shows [Element.getText h2], nightwatch-devtools shows []'
    )
  })

  it('never pairs a step with one from another test', () => {
    const tests: [string, number][] = [
      [SCENARIO_TESTS[0].title, 0],
      [SCENARIO_TESTS[1].title, 45]
    ]
    const click = { command: 'click', selector: '#logout' }
    const js = report(
      'devtools-service',
      stream(1, JS, { tests, more: [click] })
    )
    const nw = report(
      'nightwatch-devtools',
      stream(2, NW, { tests: [tests[0], [tests[1][0], 100]], more: [click] })
    )
    const messages = compareRuns([js, nw]).map((d) => d.message)
    expect(messages).toEqual([
      expect.stringContaining(
        `test "${SCENARIO_TESTS[0].title}", after Element.fill #username: devtools-service shows [], nightwatch-devtools shows [Element.click #logout]`
      ),
      expect.stringContaining(
        `test "${SCENARIO_TESTS[1].title}", after its start: devtools-service shows [Element.click #logout], nightwatch-devtools shows []`
      )
    ])
  })
})

describe('a lack its holder contradicts', () => {
  it('reports a renamed step where the lacked one stood, and calls the lack stale', () => {
    const js = report(
      'devtools-service',
      stream(1, JS, { more: [{ command: 'waitForExist', selector: '#flash' }] })
    )
    const py = report(
      'selenium-devtools-py',
      stream(2, PY, { more: [{ command: 'waitUntil' }] })
    )
    const runs = [js, py]
    const { unexplained, stale } = judgeDivergences(compareRuns(runs), runs)
    expect(unexplained.map((d) => d.message)).toEqual([
      expect.stringContaining(
        'devtools-service shows [Element.waitForExist #flash], selenium-devtools-py shows [Browser.waitForFunction]'
      )
    ])
    expect(stale.filter((g) => g.lacksSteps).map((g) => g.lacksSteps)).toEqual([
      ['Element.waitForExist #flash']
    ])
  })
})

const titleOf = (title: string) => SCENARIO_TESTS[scenarioIndex(title)].title
const WAITS = titleOf('waits on what the page shows')
const LOGIN = titleOf('logs in and reads the greeting')

const gapOf = (adapter: string, reason: string, rule = RULES.agreeOnActions) =>
  KNOWN_GAPS.find(
    (g) =>
      g.adapter === adapter &&
      g.bidi === 'live' &&
      g.reason === reason &&
      g.rules.includes(rule)
  )!

describe('a gap scoped to one hunk', () => {
  const gap = gapOf('selenium-devtools', KNOWN_DEBT.conditionWait)
  const reads =
    'Element.getText #flash, Element.getText h2, Element.getText #flash'
  const waits = 'Browser.waitForFunction, Browser.waitForFunction'
  const hunk = (first: string, second: string): Violation => ({
    rule: RULES.agreeOnActions,
    message: `a vs b: test "${WAITS}", after Element.getText #flash: ${first}, ${second}`
  })

  it('matches its holder whichever side is the reference', () => {
    const own = `selenium-devtools shows [${reads}]`
    expect(covers(gap, hunk(`devtools-service shows [${waits}]`, own))).toBe(
      true
    )
    expect(
      covers(gap, hunk(own, `selenium-devtools-py shows [${waits}]`))
    ).toBe(true)
  })

  // A condition's second read folded over its first is a different hunk, so the gap does not hide it.
  it('matches nothing else in that place', () => {
    const folded =
      'selenium-devtools shows [Element.getText h2, Element.getText #flash]'
    expect(covers(gap, hunk(`devtools-service shows [${waits}]`, folded))).toBe(
      false
    )
  })
})

// A gap scoped to one move, as a timing bug that reorders a step would declare.
const moveGap = (): KnownGap => ({
  adapter: 'nightwatch-devtools',
  bidi: 'live',
  rules: [RULES.agreeOnActions],
  only: moved(
    scenarioIndex(LOGIN),
    'Element.waitForExist #flash',
    'nightwatch-devtools',
    'Element.click button[type="submit"]'
  ),
  reason: 'Test fixture: a step one adapter shows at another place.'
})

describe('a step one adapter shows at another place', () => {
  const flashWait = { command: 'waitForExist', selector: '#flash' }
  const read = { command: 'getText', selector: '#flash' }
  const tests: [string, number][] = [[LOGIN, 0]]

  it('is one move, excused only by the gap that names it', () => {
    const js = report(
      'devtools-service',
      stream(1, JS, { tests, more: [flashWait, read] })
    )
    const nw = report(
      'nightwatch-devtools',
      stream(2, NW, { tests, more: [read, flashWait] })
    )
    const divergences = compareRuns([js, nw])
    expect(divergences.map((d) => d.message)).toEqual([
      expect.stringContaining(
        `test "${LOGIN}": Element.waitForExist #flash comes after Element.fill #username in devtools-service, after Element.getText #flash in nightwatch-devtools`
      )
    ])
    const waitOrder = moveGap()
    const sameMs = gapOf(
      'nightwatch-devtools',
      KNOWN_DEBT.nightwatchSameMsReplace
    )
    expect(covers(waitOrder, divergences[0])).toBe(false)
    expect(covers(sameMs, divergences[0])).toBe(false)
  })

  // A move excuses where the step stands, never what it did there.
  it('still compares the moved step itself', () => {
    const js = report(
      'devtools-service',
      stream(1, JS, {
        tests,
        more: [flashWait, read],
        anchors: [
          ['/login', 10],
          ['/secure', 55]
        ]
      })
    )
    const nw = report(
      'nightwatch-devtools',
      stream(2, NW, {
        tests,
        more: [
          read,
          { ...flashWait, error: { name: 'Error', message: 'timed out' } }
        ],
        anchors: [
          ['/login', 10],
          ['/secure', 55]
        ]
      })
    )
    const divergences = compareRuns([js, nw])
    const onWait = divergences.filter((d) =>
      d.message.includes(', Element.waitForExist #flash: ')
    )
    expect(onWait.map((d) => d.rule).sort()).toEqual(
      [RULES.agreeOnErrors, RULES.agreeOnPages].sort()
    )
    const waitOrder = moveGap()
    expect(onWait.some((d) => covers(waitOrder, d))).toBe(false)
  })

  it('leaves what the move did not explain to its own gap', () => {
    const waitOrder = moveGap()
    const overwrite: Violation = {
      rule: RULES.agreeOnActions,
      message: `devtools-service vs nightwatch-devtools: test "${LOGIN}", after Element.getText #flash: devtools-service shows [Assert.equal #flash], nightwatch-devtools shows [Element.getText #flash]`
    }
    const move: Violation = {
      rule: RULES.agreeOnActions,
      message: `devtools-service vs nightwatch-devtools: test "${LOGIN}": Element.waitForExist #flash comes after Element.click button[type="submit"] in devtools-service, after Assert.equal #flash in nightwatch-devtools`
    }
    expect(covers(waitOrder, move)).toBe(true)
    expect(covers(waitOrder, overwrite)).toBe(false)
    expect(
      covers(
        gapOf('nightwatch-devtools', KNOWN_DEBT.nightwatchSameMsReplace),
        overwrite
      )
    ).toBe(true)
  })
})

describe('a lack nothing checks', () => {
  const flashWait = { command: 'waitForExist', selector: '#flash' }

  // Every other adapter lacked or excused the service's wait row, so dropping it went unnoticed.
  it('goes stale when the side it is compared with never shows the step either', () => {
    const js = report('devtools-service', stream(1, JS))
    const se = report('selenium-devtools', stream(2, JS))
    const runs = [js, se]
    const { stale } = judgeDivergences(compareRuns(runs), runs)
    expect(stale.filter(declaresLacks).map((g) => g.lacksSteps)).toEqual([
      ['Element.waitForExist #flash']
    ])
    const withWait = report(
      'devtools-service',
      stream(1, JS, { more: [flashWait] })
    )
    const judged = judgeDivergences(compareRuns([withWait, se]), [withWait, se])
    expect(judged.stale.filter(declaresLacks)).toEqual([])
  })

  it('is not judged without the adapter it is matched against', () => {
    const nw = report('nightwatch-devtools', stream(1, NW))
    const se = report('selenium-devtools', stream(2, JS))
    const { stale } = judgeDivergences(compareRuns([nw, se]), [nw, se])
    expect(stale.filter((g) => g.adapter === 'selenium-devtools')).toEqual([])
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
      report('devtools-service', stream(2, JS, { options: EVERY_CONTROL }))
    ])
    expect(html).toMatch(/STALE GAPS \(\d+\)/)
    expect(html).toContain(
      'Stale gap</strong> for <code>nightwatch-devtools</code>'
    )
    expect(html).not.toContain('>AGREE<')
  })
})

describe('normalizeRun on a failed assertion or wait', () => {
  // Each binding words these failures itself, so agreement is on the failure, while a browser's own message is compared verbatim.
  it('reads the outcome as failed, whatever the wording', () => {
    const failed = (command: string, message: string) => ({
      command,
      selector: '#flash',
      error: { name: 'Error', message }
    })
    const run = normalizeRun(
      stream(1, JS, {
        error: 'net::ERR_FAILED',
        more: [
          failed('assert.equal', "Expected: 'a'"),
          failed('waitForExist', 'still not existing after 300ms')
        ]
      })
    )
    expect(run.steps.map((s) => s.outcome)).toEqual([
      'ok',
      'error: net::ERR_FAILED',
      'failed',
      'failed'
    ])
  })

  // Nightwatch reports these without an error: a collapsed result, and a wait's bare `false`.
  it('reads a row failed by the shared rule even without an error', () => {
    const run = normalizeRun(
      stream(1, NW, {
        more: [
          { command: 'assert.equal', result: { passed: false } },
          {
            command: 'waitForElementPresent',
            args: ['#missing', 300],
            result: false
          },
          { command: 'isDisplayed', result: false }
        ]
      })
    )
    expect(run.steps.slice(2).map((s) => s.outcome)).toEqual([
      'failed',
      'failed',
      'ok'
    ])
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
