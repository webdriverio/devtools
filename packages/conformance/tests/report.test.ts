import { describe, expect, it } from 'vitest'

import { RULES } from '../src/constants.js'
import { renderReport } from '../src/report-html.js'
import type { RunReport, Violation } from '../src/types.js'

const LOGIN = 'http://fake/login'
const SECURE = 'http://fake/secure'

function run(overrides: Partial<RunReport> = {}): RunReport {
  return {
    adapter: 'selenium-devtools',
    bidi: true,
    exitCode: 0,
    truth: {
      documents: [
        { url: LOGIN, bornAt: 1100 },
        { url: SECURE, bornAt: 1300 }
      ],
      failedNavigations: [],
      actions: { navigate: [], click: [], fill: [] }
    },
    violations: [],
    unexplained: [],
    stale: [],
    frames: [
      { scope: 'metadata', data: {} },
      {
        scope: 'mutations',
        data: [
          {
            type: 'childList',
            url: SECURE,
            timestamp: 1300,
            addedNodes: [],
            removedNodes: []
          }
        ]
      },
      {
        scope: 'commands',
        data: [
          { command: 'click', args: [], startTime: 1250, timestamp: 1320 },
          { command: 'get', args: [LOGIN], startTime: 1000, timestamp: 1110 }
        ]
      }
    ],
    output: '',
    ...overrides
  }
}

const unanchored: Violation = {
  rule: RULES.documentAnchored,
  message: `document ${LOGIN} born at 1100 has no anchor`,
  subject: { kind: 'document', timestamp: 1100 }
}

describe('renderReport', () => {
  it('marks a clean run PASS and a run with unexplained violations FAIL', () => {
    expect(renderReport([run()])).toContain('>PASS<')
    const failing = renderReport([
      run({ violations: [unanchored], unexplained: [unanchored] })
    ])
    expect(failing).toContain('>FAIL<')
    expect(failing).not.toContain('>PASS<')
  })

  it('marks a nonzero exit as FAIL', () => {
    expect(renderReport([run({ exitCode: 1 })])).toContain('>FAIL<')
  })

  it('shows an unexplained violation inline next to its document', () => {
    const html = renderReport([
      run({ violations: [unanchored], unexplained: [unanchored] })
    ])
    const row = html.slice(html.indexOf(`document born</td><td><code>${LOGIN}`))
    expect(row.slice(0, row.indexOf('</tr>'))).toContain(
      '<li class="unexplained"><strong>UNEXPLAINED</strong>'
    )
  })

  it('marks an allowlisted violation with its gap reason', () => {
    const html = renderReport([
      run({ bidi: false, violations: [unanchored], unexplained: [] })
    ])
    expect(html).toContain('<li class="allowed"><strong>allowlisted</strong>')
    expect(html).toContain('allowlisted: Without BiDi the collector')
    expect(html).not.toContain('class="unexplained"')
    expect(html).toContain('>PASS<')
  })

  it('escapes text taken from the stream', () => {
    const hostile = '<script>alert("x")</script>'
    const html = renderReport([
      run({
        frames: [
          {
            scope: 'commands',
            data: [
              {
                command: 'sendKeys',
                args: [hostile],
                startTime: 1000,
                timestamp: 1010
              }
            ]
          }
        ],
        output: hostile
      })
    ])
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })

  it('orders events by time, relative to the first event', () => {
    const html = renderReport([run()])
    const order = [
      '>+0 ms<',
      `<code>${LOGIN}</code> +0 ms .. +110 ms`,
      `document born</td><td><code>${LOGIN}`,
      '>+250 ms<',
      `document born</td><td><code>${SECURE}`,
      `DOM anchor</td><td><code>${SECURE}`
    ].map((s) => html.indexOf(s))
    expect(order.every((i) => i !== -1)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
  })

  it('points a failing run at the responsibility the broken rule tests', () => {
    const html = renderReport([
      run({
        adapter: 'selenium-devtools-py',
        violations: [unanchored],
        unexplained: [unanchored]
      })
    ])
    expect(html).toContain('Where to look')
    expect(html).toContain('Collector injection and draining')
    expect(html).toContain(
      'href="../../../docs/ADAPTERS.md#2b-collector-injection-and-draining"'
    )
  })

  it('shows no guidance for a passing run', () => {
    expect(renderReport([run()])).not.toContain('Where to look')
  })
})
