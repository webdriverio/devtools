import { describe, expect, it } from 'vitest'
import type { SuiteStats, TestStats } from '@wdio/devtools-shared'
import { buildArtifactsManifest } from '../../core/src/artifacts-manifest.js'
import { collectSuiteTestMetadata } from '../../core/src/suite-helpers.js'
import {
  hasRetentionFilter,
  parseManifest,
  type Manifest
} from '../src/manifest.js'

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

describe('hasRetentionFilter', () => {
  it('is false when every artifact is retained', () => {
    expect(hasRetentionFilter(valid)).toBe(false)
  })

  it('is true when any artifact was decided against', () => {
    const filtered = {
      ...valid,
      artifacts: [{ ...valid.artifacts[0], retained: false }]
    }
    expect(hasRetentionFilter(filtered)).toBe(true)
  })
})

describe('a manifest written from a cucumber suite tree', () => {
  const step = (uid: string, retries: number): TestStats => ({
    uid,
    cid: '0-0',
    title: uid,
    fullTitle: `checkout ${uid}`,
    parent: 'scenario',
    state: 'passed',
    start: new Date(0),
    end: new Date(1),
    type: 'test',
    file: '/a.feature',
    retries,
    _duration: 1
  })
  const suite = (
    uid: string,
    tests: TestStats[],
    suites: SuiteStats[] = []
  ): SuiteStats => ({
    uid,
    cid: '0-0',
    title: uid,
    fullTitle: uid,
    type: 'suite',
    file: '/a.feature',
    start: new Date(0),
    state: 'passed',
    tests,
    suites,
    hooks: [],
    _duration: 0
  })

  it('is accepted, with the scenario as the one test on its own attempt', () => {
    const tree = suite(
      'feature',
      [],
      [suite('scenario', [step('given', 1), step('then', 1)])]
    )
    const manifest = buildArtifactsManifest({
      sessionId: 's1',
      format: 'zip',
      artifacts: [],
      testMetadata: collectSuiteTestMetadata([tree])
    })

    const parsed = parseManifest(
      JSON.parse(JSON.stringify(manifest)),
      'manifest.json'
    )

    expect(parsed.tests).toEqual([
      expect.objectContaining({ uid: 'scenario', state: 'passed', attempt: 1 })
    ])
  })
})
