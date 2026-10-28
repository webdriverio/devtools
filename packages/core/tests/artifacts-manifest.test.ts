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
