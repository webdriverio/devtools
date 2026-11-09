import { describe, expect, it } from 'vitest'
import { parseManifest, type Manifest } from '../src/manifest.js'

const TRACE_ID = '4bf92f3577b34da6a3ce929d0e0e4736'
const SPAN_ID = '00f067aa0ba902b7'

const valid: Manifest = {
  sessionId: 's1',
  artifacts: [
    { kind: 'trace', path: 'traces/a.zip', testUids: ['u1'], retained: true }
  ],
  tests: [
    {
      uid: 'u1',
      title: 'a',
      specFile: 'a.spec.ts',
      state: 'passed',
      attempt: 0
    }
  ]
}

describe('parseManifest', () => {
  it('accepts a well-formed manifest', () => {
    expect(parseManifest(valid, 'm.json')).toEqual(valid)
  })

  it('throws naming the keys it found when the shape is wrong', () => {
    expect(() =>
      parseManifest({ sessionId: 's1', tests: [] }, 'm.json')
    ).toThrow(
      'm.json is not an artifacts manifest: expected sessionId, artifacts, tests (artifacts and tests with their fields); found sessionId, tests'
    )
  })

  it('rejects an artifact without a boolean retained flag', () => {
    const broken = {
      ...valid,
      artifacts: [{ kind: 'trace', path: 'a.zip', testUids: [] }]
    }
    expect(() => parseManifest(broken, 'm.json')).toThrow(
      'is not an artifacts manifest'
    )
  })

  it('rejects an artifact whose kind is not trace, video or screenshot', () => {
    const broken = {
      ...valid,
      artifacts: [{ ...valid.artifacts[0], kind: 'har' }]
    }
    expect(() => parseManifest(broken, 'm.json')).toThrow(
      'm.json is not an artifacts manifest'
    )
  })

  it('accepts video and screenshot artifacts', () => {
    const media = {
      ...valid,
      artifacts: ['video', 'screenshot'].map((kind) => ({
        ...valid.artifacts[0],
        kind
      }))
    }
    expect(parseManifest(media, 'm.json').artifacts).toHaveLength(2)
  })

  it('drops step entries without a state from the parsed tests', () => {
    const cucumber = {
      ...valid,
      tests: [
        valid.tests[0],
        { uid: 'step-1', title: 'Given a user', specFile: 'a.feature' },
        { uid: 'step-2', title: 'When they log in' }
      ]
    }
    expect(parseManifest(cucumber, 'm.json').tests).toEqual(valid.tests)
  })

  it('names the index and keys of a malformed test entry', () => {
    const broken = {
      ...valid,
      tests: [
        valid.tests[0],
        { uid: 'step-1', specFile: 'a.feature', state: 5 }
      ]
    }
    expect(() => parseManifest(broken, 'm.json')).toThrow(
      'm.json is not an artifacts manifest: expected sessionId, artifacts, tests (artifacts and tests with their fields); found sessionId, artifacts, tests; tests[1] is neither a test nor a step (keys: uid, specFile, state)'
    )
  })
})

describe('parseManifest timing and keys', () => {
  it('keeps the optional timing, error and artifact key fields', () => {
    const timed: Manifest = {
      ...valid,
      artifacts: [{ ...valid.artifacts[0], key: 'u1' }],
      tests: [
        {
          ...valid.tests[0],
          startTime: 1,
          endTime: 2,
          durationMs: 1,
          error: 'boom'
        }
      ]
    }
    expect(parseManifest(timed, 'm.json')).toEqual(timed)
  })

  it('rejects a non-numeric timing field', () => {
    const broken = {
      ...valid,
      tests: [{ ...valid.tests[0], endTime: '2025-01-01' }]
    }
    expect(() => parseManifest(broken, 'm.json')).toThrow(
      'tests[0] is neither a test nor a step'
    )
  })
})

describe('parseManifest run identity and attempts', () => {
  const attempt = {
    attempt: 0,
    state: 'passed',
    startTime: 1,
    endTime: 2,
    traceId: TRACE_ID,
    spanId: SPAN_ID,
    final: true
  }
  const stamped = {
    ...valid,
    runId: 'run-7',
    parent: {
      traceId: TRACE_ID,
      spanId: SPAN_ID,
      traceFlags: 1,
      traceState: 'vendor=x'
    },
    tests: [{ ...valid.tests[0], attempts: [attempt] }]
  }

  it('accepts a manifest with a run id, a parent and per-attempt ids', () => {
    expect(parseManifest(stamped, 'm.json')).toEqual(stamped)
  })

  it('accepts a manifest from before attempts existed', () => {
    expect(parseManifest(valid, 'm.json')).toEqual(valid)
  })

  it('rejects a trace id that is not 32 lowercase hex characters', () => {
    const broken = {
      ...stamped,
      tests: [{ ...valid.tests[0], attempts: [{ ...attempt, traceId: 'abc' }] }]
    }
    expect(() => parseManifest(broken, 'm.json')).toThrow(
      'is not an artifacts manifest'
    )
  })

  it.each([
    ['uppercase', SPAN_ID.toUpperCase()],
    ['15-character', SPAN_ID.slice(1)]
  ])('rejects a %s span id', (_, spanId) => {
    const broken = {
      ...stamped,
      tests: [{ ...valid.tests[0], attempts: [{ ...attempt, spanId }] }]
    }
    expect(() => parseManifest(broken, 'm.json')).toThrow(
      'is not an artifacts manifest'
    )
  })

  it.each([
    ['trace', { traceId: '0'.repeat(32) }],
    ['span', { spanId: '0'.repeat(16) }]
  ])('rejects an all-zero %s id, which W3C reserves as invalid', (_, ids) => {
    const broken = {
      ...stamped,
      tests: [{ ...valid.tests[0], attempts: [{ ...attempt, ...ids }] }]
    }
    expect(() => parseManifest(broken, 'm.json')).toThrow(
      'is not an artifacts manifest'
    )
  })

  it.each([
    ['none', [{ ...attempt, final: undefined }]],
    ['two', [attempt, { ...attempt, attempt: 1 }]]
  ])('rejects attempts with %s stamped final', (_, attempts) => {
    const broken = { ...stamped, tests: [{ ...valid.tests[0], attempts }] }
    expect(() => parseManifest(broken, 'm.json')).toThrow(
      'is not an artifacts manifest'
    )
  })

  it('rejects an attempt without a start time', () => {
    const { startTime: _omitted, ...rest } = attempt
    const broken = {
      ...stamped,
      tests: [{ ...valid.tests[0], attempts: [rest] }]
    }
    expect(() => parseManifest(broken, 'm.json')).toThrow(
      'is not an artifacts manifest'
    )
  })

  it('rejects a parent whose trace flags are out of byte range', () => {
    const broken = {
      ...stamped,
      parent: { ...stamped.parent, traceFlags: 256 }
    }
    expect(() => parseManifest(broken, 'm.json')).toThrow(
      'is not an artifacts manifest'
    )
  })

  it('rejects a non-string run id', () => {
    expect(() => parseManifest({ ...valid, runId: 7 }, 'm.json')).toThrow(
      'is not an artifacts manifest'
    )
  })
})
