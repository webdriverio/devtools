import { describe, it, expect } from 'vitest'
import {
  buildSpecCapturer,
  buildSpecSessionId,
  filterTestMetadataBySpec,
  sanitizeSpecName,
  type SpecRange,
  type TraceCapturer
} from '@wdio/devtools-core'
import { TraceType, type TestMetadataMap } from '@wdio/devtools-shared'

function capturer(): TraceCapturer {
  const cmd = (i: number) => ({
    command: 'url',
    args: [String(i)],
    timestamp: i,
    startTime: i
  })
  return {
    mutations: [{ m: 0 }, { m: 1 }, { m: 2 }] as never,
    traceLogs: ['t0', 't1', 't2'],
    consoleLogs: [{ c: 0 }, { c: 1 }, { c: 2 }] as never,
    networkRequests: [{ n: 0 }, { n: 1 }, { n: 2 }] as never,
    commandsLog: [cmd(0), cmd(1), cmd(2), cmd(3)],
    sources: new Map([['/a.js', 'source']]),
    metadata: { type: TraceType.Standalone },
    startWallTime: 0
  }
}

const range = (over: Partial<SpecRange> = {}): SpecRange => ({
  specFile: '/a.js',
  commandStartIdx: 0,
  consoleStartIdx: 0,
  networkStartIdx: 0,
  mutationStartIdx: 0,
  traceLogStartIdx: 0,
  snapshotCount: 0,
  ...over
})

describe('buildSpecCapturer', () => {
  it('slices from the range start to the end when no nextRange is given', () => {
    const sliced = buildSpecCapturer(capturer(), range({ commandStartIdx: 2 }))
    expect(sliced.commandsLog).toHaveLength(2)
    expect(sliced.commandsLog.map((c) => c.args[0])).toEqual(['2', '3'])
  })

  it('slices to nextRange start indices when provided', () => {
    const sliced = buildSpecCapturer(
      capturer(),
      range({ commandStartIdx: 1, consoleStartIdx: 1 }),
      range({ commandStartIdx: 3, consoleStartIdx: 2 })
    )
    expect(sliced.commandsLog.map((c) => c.args[0])).toEqual(['1', '2'])
    expect(sliced.consoleLogs).toHaveLength(1)
  })

  it('clones the source map so later parent mutations do not leak in', () => {
    const parent = capturer()
    const sliced = buildSpecCapturer(parent, range())
    parent.sources.set('/b.js', 'added-later')
    expect(sliced.sources.has('/b.js')).toBe(false)
  })
})

describe('filterTestMetadataBySpec', () => {
  it('keeps only entries whose specFile matches', () => {
    const all: TestMetadataMap = new Map([
      ['u1', { title: 'A', specFile: '/a.js' }],
      ['u2', { title: 'B', specFile: '/b.js' }],
      ['u3', { title: 'C', specFile: '/a.js' }]
    ])
    const filtered = filterTestMetadataBySpec(all, '/a.js')
    expect([...filtered.keys()]).toEqual(['u1', 'u3'])
  })
})

describe('spec name / session id', () => {
  it('sanitizes unsafe characters and falls back to unknown-spec', () => {
    expect(sanitizeSpecName('/tests/login flow.ts')).toBe('login_flow')
    expect(sanitizeSpecName('/specs/login.spec.ts')).toBe('login_spec')
    expect(sanitizeSpecName('....')).toBe('unknown-spec')
  })

  it('derives a stable, collision-resistant spec session id', () => {
    const a = buildSpecSessionId('/dir1/login.js', 'session-xyz')
    const b = buildSpecSessionId('/dir2/login.js', 'session-xyz')
    expect(a).not.toBe(b)
    expect(a).toBe(buildSpecSessionId('/dir1/login.js', 'session-xyz'))
    expect(a.startsWith('login-')).toBe(true)
  })
})
