import { describe, it, expect, afterEach } from 'vitest'
import { rm, readFile, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  buildArtifactsManifest,
  writeArtifactsManifest,
  artifactsManifestFilename,
  type ArtifactsManifest
} from '../src/artifacts-manifest.js'
import type { TraceArtifact } from '../src/trace-finalizer.js'
import type { TestMetadataMap } from '@wdio/devtools-shared'
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
    const scenario = { uid: 's1', title: 'checkout', kind: 'scenario' as const }
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
    expect(parsed).toEqual(manifest)
  })
})
