import { describe, expect, it } from 'vitest'

import { compareRuns, judgeDivergences } from '../src/agreement.js'
import { RULES } from '../src/constants.js'
import { normalizeRun } from '../src/normalize.js'
import { renderReport } from '../src/report-html.js'
import type { AdapterId, RunReport, WireFrame } from '../src/types.js'

const anchor = (url: string, timestamp: number) => ({
  type: 'childList',
  url,
  timestamp,
  addedNodes: [],
  removedNodes: []
})

/** One adapter's stream for: navigate to /login, type into #username. */
function stream(
  port: number,
  names: { navigate: string; fill: string },
  error?: string
): WireFrame[] {
  return [
    {
      scope: 'metadata',
      data: {
        type: 'testrunner',
        options: { runCapabilities: { canRunAll: true }, launchCommand: 'run' }
      }
    },
    {
      scope: 'commands',
      data: [
        {
          command: names.navigate,
          args: [`http://127.0.0.1:${port}/login`],
          startTime: 0,
          timestamp: 20
        },
        {
          command: names.fill,
          args: ['tom'],
          selector: '#username',
          startTime: 30,
          timestamp: 40,
          ...(error ? { error: { name: 'Error', message: error } } : {})
        }
      ]
    },
    { scope: 'mutations', data: [anchor(`http://127.0.0.1:${port}/login`, 10)] }
  ]
}

const report = (
  adapter: AdapterId,
  frames: WireFrame[],
  bidi = true
): RunReport => ({
  adapter,
  bidi,
  exitCode: 0,
  truth: {
    documents: [],
    failedNavigations: [],
    actions: { navigate: [], click: [], fill: [] }
  },
  violations: [],
  unexplained: [],
  stale: [],
  frames,
  output: ''
})

const JS = { navigate: 'get', fill: 'sendKeys' }
const PY = { navigate: 'get', fill: 'sendKeysToElement' }

describe('normalizeRun', () => {
  it("reduces each adapter's command names and ports to what a user sees", () => {
    expect(normalizeRun(stream(1111, JS))).toEqual(
      normalizeRun(stream(2222, PY))
    )
    expect(normalizeRun(stream(1111, JS)).steps[1]).toEqual({
      action: 'Element.fill',
      target: '#username',
      outcome: 'ok',
      page: '/login'
    })
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

  it('flags a step that fails with different text, with no rule written for that field', () => {
    const divergences = compareRuns([
      report('selenium-devtools', stream(1, JS, 'net::ERR_FAILED')),
      report('selenium-devtools-py', stream(2, PY, 'Message: net::ERR_FAILED'))
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
    const unanchored = stream(2, PY).filter((f) => f.scope !== 'mutations')
    const rules = compareRuns([
      report('selenium-devtools', stream(1, JS)),
      report('selenium-devtools-py', unanchored)
    ]).map((d) => d.rule)
    expect(rules).toEqual([
      RULES.agreeOnPages,
      RULES.agreeOnPages,
      RULES.agreeOnSnapshots
    ])
  })
})

describe('judgeDivergences', () => {
  const missingAnchor = {
    rule: RULES.documentAnchored,
    message: 'document /login has no anchor'
  }

  it("excuses a difference while the holder's own run shows its gap", () => {
    const js = {
      ...report(
        'selenium-devtools',
        stream(1, JS).filter((f) => f.scope !== 'mutations'),
        false
      ),
      violations: [missingAnchor]
    }
    const py = report('selenium-devtools-py', stream(2, PY), false)
    const { unexplained } = judgeDivergences(compareRuns([js, py]), [js, py])
    expect(unexplained).toEqual([])
  })

  // Regression: a gap excused any matching difference, so it masked the OTHER adapter regressing.
  it('does not excuse a difference when the gap is not occurring', () => {
    const js = report('selenium-devtools', stream(1, JS), false)
    const py = report(
      'selenium-devtools-py',
      stream(2, PY).filter((f) => f.scope !== 'mutations'),
      false
    )
    const { unexplained } = judgeDivergences(compareRuns([js, py]), [js, py])
    expect(unexplained.map((d) => d.rule)).toContain(RULES.agreeOnSnapshots)
  })

  it('does not excuse a difference in a mode the gap does not cover', () => {
    const js = {
      ...report(
        'selenium-devtools',
        stream(1, JS).filter((f) => f.scope !== 'mutations'),
        true
      ),
      violations: [missingAnchor]
    }
    const py = report('selenium-devtools-py', stream(2, PY), true)
    const { unexplained } = judgeDivergences(compareRuns([js, py]), [js, py])
    expect(unexplained).toHaveLength(3)
  })
})

describe('the agreement section of the report', () => {
  it('marks a mode where adapters diverge, and highlights the differing row', () => {
    const html = renderReport([
      report('selenium-devtools', stream(1, JS, 'net::ERR_FAILED')),
      report('selenium-devtools-py', stream(2, PY, 'Message: net::ERR_FAILED'))
    ])
    expect(html).toContain('Do the adapters agree?')
    expect(html).toContain('DIVERGE')
    expect(html).not.toContain('KNOWN DIFFERENCES')
    expect(html).toContain('class="differs"')
  })
})
