import { describe, it, expect, afterEach, vi } from 'vitest'
import { rm, readFile, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import {
  buildArtifactsManifest,
  writeArtifactsManifest,
  artifactsManifestFilename
} from '../src/artifacts-manifest.js'
import type {
  ArtifactsManifest,
  TestMetadataMap,
  TraceArtifact
} from '@wdio/devtools-shared'
import { stepMetadataUid } from '../src/uid.js'

function metadata(): TestMetadataMap {
  return new Map([
    [
      'u1',
      { title: 'passes', specFile: '/a.spec.ts', state: 'passed', attempt: 0 }
    ],
    [
      'u2',
      { title: 'fails', specFile: '/a.spec.ts', state: 'failed', attempt: 1 }
    ]
  ])
}

const artifacts: TraceArtifact[] = [
  {
    kind: 'trace',
    path: '/out/u1.zip',
    scope: 'test',
    key: 'u1',
    testUids: ['u1'],
    retained: false
  },
  {
    kind: 'trace',
    path: '/out/u2.zip',
    scope: 'test',
    key: 'u2',
    testUids: ['u2'],
    retained: true
  }
]

describe('artifacts manifest', () => {
  const dirs: string[] = []
  afterEach(async () => {
    await Promise.all(
      dirs.splice(0).map((d) => rm(d, { recursive: true, force: true }))
    )
  })

  it('buildArtifactsManifest carries every artifact (retained + not) and per-test states', () => {
    const m = buildArtifactsManifest({
      sessionId: 'sess-1',
      format: 'zip',
      artifacts,
      testMetadata: metadata()
    })
    expect(m.sessionId).toBe('sess-1')
    expect(m.format).toBe('zip')
    expect(m.artifacts).toEqual(artifacts)
    expect(m.artifacts).not.toBe(artifacts) // copied, not aliased
    expect(m.tests).toEqual([
      {
        uid: 'u1',
        title: 'passes',
        specFile: '/a.spec.ts',
        state: 'passed',
        attempt: 0
      },
      {
        uid: 'u2',
        title: 'fails',
        specFile: '/a.spec.ts',
        state: 'failed',
        attempt: 1
      }
    ])
  })

  it('copies per-test timing and failure when the metadata carries them', () => {
    const testMetadata: TestMetadataMap = new Map([
      [
        'u2',
        {
          title: 'fails',
          specFile: '/a.spec.ts',
          state: 'failed',
          attempt: 1,
          startTime: 1000,
          endTime: 1500,
          durationMs: 480,
          error: 'boom'
        }
      ]
    ])
    const m = buildArtifactsManifest({
      sessionId: 'sess-t',
      format: 'zip',
      artifacts: [],
      testMetadata
    })
    expect(m.tests).toEqual([
      {
        uid: 'u2',
        title: 'fails',
        specFile: '/a.spec.ts',
        state: 'failed',
        attempt: 1,
        startTime: 1000,
        endTime: 1500,
        durationMs: 480,
        error: 'boom'
      }
    ])
  })

  it('leaves timing and error keys out of the file when the metadata lacks them', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'manifest-'))
    dirs.push(dir)
    const m = buildArtifactsManifest({
      sessionId: 'sess-u',
      format: 'zip',
      artifacts: [],
      testMetadata: metadata()
    })
    const filePath = await writeArtifactsManifest(dir, m)
    const parsed = JSON.parse(await readFile(filePath, 'utf8')) as {
      tests: Record<string, unknown>[]
    }
    expect(Object.keys(parsed.tests[0]).sort()).toEqual(
      ['attempt', 'specFile', 'state', 'title', 'uid'].sort()
    )
  })

  it('leaves out a step nested as a test under a scenario suite', () => {
    const feature = { uid: 'f1', title: 'Cart', kind: 'feature' as const }
    const scenario = {
      uid: 's1',
      title: 'checkout',
      kind: 'scenario' as const
    }
    const testMetadata: TestMetadataMap = new Map([
      [
        's1',
        {
          title: 'checkout',
          specFile: '/a.feature',
          state: 'passed',
          ancestry: [feature]
        }
      ],
      [
        'step-1',
        {
          title: 'Given a cart',
          specFile: '/a.feature',
          state: 'passed',
          attempt: 0,
          ancestry: [feature, scenario]
        }
      ],
      [
        'mocha-test',
        {
          title: 'plain test',
          specFile: '/a.spec.ts',
          state: 'passed',
          attempt: 0,
          ancestry: [{ uid: 'd1', title: 'describe', kind: 'suite' as const }]
        }
      ]
    ])
    const manifest = buildArtifactsManifest({
      sessionId: 's',
      format: 'zip',
      artifacts: [],
      testMetadata
    })
    expect(manifest.tests.map((t) => t.uid)).toEqual(['s1', 'mocha-test'])
  })

  it("leaves a scenario's steps out of tests[]", () => {
    const testMetadata: TestMetadataMap = new Map([
      [
        'stable-abc',
        {
          title: 'checkout',
          specFile: '/a.feature',
          state: 'passed',
          attempt: 0
        }
      ],
      [
        stepMetadataUid('stable-abc', 1),
        { title: 'Given a cart', specFile: '/a.feature' }
      ],
      [
        stepMetadataUid('stable-abc', 2),
        { title: 'When I pay', specFile: '/a.feature' }
      ]
    ])
    const m = buildArtifactsManifest({
      sessionId: 'sess-s',
      format: 'zip',
      artifacts: [],
      testMetadata
    })
    expect(m.tests.map((t) => t.uid)).toEqual(['stable-abc'])
  })

  it('keeps a step-looking uid whose owner is not in the map', () => {
    const testMetadata: TestMetadataMap = new Map([
      ['orphan:step:1', { title: 'stray', specFile: '/a.feature' }]
    ])
    const m = buildArtifactsManifest({
      sessionId: 'sess-o',
      format: 'zip',
      artifacts: [],
      testMetadata
    })
    expect(m.tests.map((t) => t.uid)).toEqual(['orphan:step:1'])
  })

  it('carries the run id, parent context and per-attempt records when given', () => {
    const attempts = [
      {
        attempt: 1,
        state: 'failed' as const,
        startTime: 1,
        endTime: 2,
        traceId: '0af7651916cd43dd8448eb211c80319c',
        spanId: 'b7ad6b7169203331'
      }
    ]
    const m = buildArtifactsManifest({
      sessionId: 'sess-r',
      format: 'zip',
      artifacts: [],
      testMetadata: metadata(),
      runId: 'run-1',
      parent: {
        traceId: '0af7651916cd43dd8448eb211c80319c',
        spanId: 'b7ad6b7169203331',
        traceFlags: 1,
        traceState: 'vendor=1'
      },
      attemptsFor: (uid) => (uid === 'u2' ? attempts : [])
    })
    expect(m.runId).toBe('run-1')
    expect(m.parent?.traceState).toBe('vendor=1')
    expect(m.tests[0]).not.toHaveProperty('attempts')
    expect(m.tests[1]!.attempts).toEqual([{ ...attempts[0], final: true }])
  })

  it('leaves run id, parent and attempts out when not given', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'manifest-'))
    dirs.push(dir)
    const m = buildArtifactsManifest({
      sessionId: 'sess-n',
      format: 'zip',
      artifacts: [],
      testMetadata: metadata()
    })
    const parsed = JSON.parse(
      await readFile(await writeArtifactsManifest(dir, m), 'utf8')
    ) as Record<string, unknown>
    expect(parsed).not.toHaveProperty('runId')
    expect(parsed).not.toHaveProperty('parent')
    expect(m.tests.every((t) => !('attempts' in t))).toBe(true)
  })

  it('stamps final on the last recorded attempt when none matches the test attempt', () => {
    const record = (attempt: number) => ({
      attempt,
      startTime: attempt,
      traceId: '0af7651916cd43dd8448eb211c80319c',
      spanId: 'b7ad6b7169203331'
    })
    const testMetadata: TestMetadataMap = new Map([
      ['u1', { title: 'a', specFile: '/a.js', state: 'passed', attempt: 1 }],
      ['u2', { title: 'b', specFile: '/a.js', state: 'passed', attempt: 5 }]
    ])
    const m = buildArtifactsManifest({
      sessionId: 'sess-f',
      format: 'zip',
      artifacts: [],
      testMetadata,
      attemptsFor: () => [record(0), record(1)]
    })
    expect(m.tests[0]!.attempts).toEqual([
      record(0),
      { ...record(1), final: true }
    ])
    expect(m.tests[1]!.attempts!.map((a) => a.final)).toEqual([undefined, true])
  })

  it('stamps final on the last recorded attempt when the test has no attempt number', () => {
    const record = (attempt: number) => ({
      attempt,
      startTime: attempt,
      traceId: '0af7651916cd43dd8448eb211c80319c',
      spanId: 'b7ad6b7169203331'
    })
    const testMetadata: TestMetadataMap = new Map([
      ['u1', { title: 'a', specFile: '/a.js', state: 'passed' }]
    ])
    const m = buildArtifactsManifest({
      sessionId: 'sess-l',
      format: 'zip',
      artifacts: [],
      testMetadata,
      attemptsFor: () => [record(0), record(1)]
    })
    expect(m.tests[0]!.attempts!.map((a) => a.final)).toEqual([undefined, true])
  })

  it('filename is deterministic per session', () => {
    expect(artifactsManifestFilename('abc')).toBe('devtools-artifacts-abc.json')
  })

  it('writeArtifactsManifest round-trips the JSON to disk', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'manifest-'))
    dirs.push(dir)
    const manifest = buildArtifactsManifest({
      sessionId: 'sess-2',
      format: 'zip',
      artifacts,
      testMetadata: metadata()
    })
    const filePath = await writeArtifactsManifest(dir, manifest)
    expect(filePath).toBe(join(dir, 'devtools-artifacts-sess-2.json'))
    const parsed = JSON.parse(
      await readFile(filePath, 'utf8')
    ) as ArtifactsManifest
    expect(parsed).toEqual({
      ...manifest,
      artifacts: artifacts.map((a) => ({ ...a, path: relative(dir, a.path) }))
    })
  })

  it('writes artifact paths relative to the manifest directory', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'manifest-'))
    dirs.push(dir)
    const inside = join(dir, 'traces', 'u1.zip')
    const manifest = buildArtifactsManifest({
      sessionId: 'sess-rel',
      format: 'zip',
      artifacts: [
        { ...artifacts[0]!, path: inside },
        { ...artifacts[1]!, path: '' }
      ],
      testMetadata: metadata()
    })
    const filePath = await writeArtifactsManifest(dir, manifest)
    const parsed = JSON.parse(
      await readFile(filePath, 'utf8')
    ) as ArtifactsManifest
    expect(parsed.artifacts.map((a) => a.path)).toEqual(['traces/u1.zip', ''])
    expect(manifest.artifacts[0]!.path).toBe(inside)
  })

  it('passes browser identity through, leaving unset keys out', () => {
    const m = buildArtifactsManifest({
      sessionId: 'sess-id',
      format: 'zip',
      artifacts: [],
      testMetadata: metadata(),
      browserName: 'chrome',
      browserVersion: '150.0',
      platformName: 'linux'
    })
    expect(m).toMatchObject({
      browserName: 'chrome',
      browserVersion: '150.0',
      platformName: 'linux'
    })
    const bare = buildArtifactsManifest({
      sessionId: 'sess-bare',
      format: 'zip',
      artifacts: [],
      testMetadata: metadata()
    })
    expect(bare).not.toHaveProperty('browserName')
  })

  it('versions the format and never carries an absolute cwd', () => {
    const m = buildArtifactsManifest({
      sessionId: 'sess-v',
      format: 'zip',
      artifacts: [],
      testMetadata: metadata()
    })
    expect(m.manifestVersion).toBe(2)
    expect(Object.keys(m)[0]).toBe('manifestVersion')
    expect(m).not.toHaveProperty('cwd')
  })

  it('writes a spec file under specRoot relative to it, and keeps one outside it', () => {
    const m = buildArtifactsManifest({
      sessionId: 'sess-s',
      format: 'zip',
      artifacts: [],
      testMetadata: new Map([
        [
          'inside',
          {
            title: 'in',
            specFile: '/work/proj/tests/a.spec.ts',
            state: 'passed',
            attempt: 0
          }
        ],
        [
          'outside',
          {
            title: 'out',
            specFile: '/elsewhere/b.spec.ts',
            state: 'passed',
            attempt: 0
          }
        ],
        [
          'relative',
          { title: 'rel', specFile: 'c.spec.ts', state: 'passed', attempt: 0 }
        ]
      ]),
      specRoot: '/work/proj'
    })
    expect(m.tests.map((t) => t.specFile)).toEqual([
      'tests/a.spec.ts',
      '/elsewhere/b.spec.ts',
      'c.spec.ts'
    ])
  })

  it('warns once when the final attempt matches no recorded attempt', () => {
    const warn = vi.fn()
    const attempt = (n: number) => ({
      attempt: n,
      state: 'failed' as const,
      startTime: n,
      endTime: n + 1,
      traceId: '0af7651916cd43dd8448eb211c80319c',
      spanId: 'b7ad6b7169203331'
    })
    buildArtifactsManifest({
      sessionId: 'sess-w',
      format: 'zip',
      artifacts: [],
      testMetadata: new Map([
        ['u9', { title: 't', specFile: '/a.js', state: 'passed', attempt: 5 }]
      ]),
      attemptsFor: () => [attempt(0), attempt(1)],
      warn
    })
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0]![0]).toContain('u9')
    expect(warn.mock.calls[0]![0]).toContain('attempt 5')
    expect(warn.mock.calls[0]![0]).toContain('0, 1')
  })

  it('does not warn when the final attempt matches a recorded attempt', () => {
    const warn = vi.fn()
    buildArtifactsManifest({
      sessionId: 'sess-m',
      format: 'zip',
      artifacts: [],
      testMetadata: new Map([
        ['u9', { title: 't', specFile: '/a.js', state: 'passed', attempt: 1 }]
      ]),
      attemptsFor: () => [
        {
          attempt: 0,
          startTime: 0,
          traceId: '0af7651916cd43dd8448eb211c80319c',
          spanId: 'b7ad6b7169203331'
        },
        {
          attempt: 1,
          startTime: 1,
          traceId: '0af7651916cd43dd8448eb211c80319c',
          spanId: 'b7ad6b7169203331'
        }
      ],
      warn
    })
    expect(warn).not.toHaveBeenCalled()
  })
})
