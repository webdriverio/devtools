import { describe, expect, it } from 'vitest'
import type { TestAttemptRecord } from '@wdio/devtools-shared'
import { traceArtifactsByUid } from '../src/artifact-sources.js'
import type {
  Manifest,
  ManifestArtifact,
  ManifestTest
} from '../src/manifest.js'

const UID = 'uid-login'
const TRACE_ID = '0af7651916cd43dd8448eb211c80319c'
const SPAN_ID = 'b7ad6b7169203331'

function traceZip(path: string, key?: string): ManifestArtifact {
  return { kind: 'trace', path, key, testUids: [UID], retained: true }
}

function record(attempt: number, final?: boolean): TestAttemptRecord {
  return { attempt, startTime: 0, traceId: TRACE_ID, spanId: SPAN_ID, final }
}

function manifestOf(
  artifacts: ManifestArtifact[],
  test: Partial<ManifestTest> & Pick<ManifestTest, 'attempt'>
): Manifest {
  return {
    sessionId: 's1',
    artifacts,
    tests: [
      {
        uid: UID,
        title: 'logs in',
        specFile: 'specs/login.spec.ts',
        state: 'failed',
        ...test
      }
    ]
  }
}

function linkedPath(manifest: Manifest): string | undefined {
  return traceArtifactsByUid(manifest).get(UID)?.path
}

describe('traceArtifactsByUid', () => {
  it('links the zip whose key is the test attempt exactly', () => {
    const manifest = manifestOf(
      [
        traceZip('traces/login.zip', UID),
        traceZip('traces/login-retry1.zip', `${UID}-retry1`)
      ],
      { attempt: 1 }
    )
    expect(linkedPath(manifest)).toBe('traces/login-retry1.zip')
  })

  it('links a specFileRetries zip keyed by the bare uid when the final record is attempt 0', () => {
    const manifest = manifestOf([traceZip('traces/login.zip', UID)], {
      attempt: 1,
      attempts: [record(0, true)]
    })
    expect(linkedPath(manifest)).toBe('traces/login.zip')
  })

  it('links nothing for an in-process retry whose final record has no zip', () => {
    const manifest = manifestOf([traceZip('traces/login.zip', UID)], {
      attempt: 1,
      attempts: [record(0), record(1, true)]
    })
    expect(linkedPath(manifest)).toBeUndefined()
  })

  it('links the final record zip when in-process retries each have one', () => {
    const manifest = manifestOf(
      [
        traceZip('traces/login.zip', UID),
        traceZip('traces/login-retry1.zip', `${UID}-retry1`)
      ],
      { attempt: 1, attempts: [record(0), record(1, true)] }
    )
    expect(linkedPath(manifest)).toBe('traces/login-retry1.zip')
  })

  it('links a spec-scope zip keyed by its spec file', () => {
    const manifest = manifestOf(
      [traceZip('traces/login-spec.zip', 'specs/login.spec.ts')],
      { attempt: 0 }
    )
    expect(linkedPath(manifest)).toBe('traces/login-spec.zip')
  })

  it('never links an artifact of another kind with the same uid and key', () => {
    const manifest = manifestOf(
      [
        { ...traceZip('screens/login.png', UID), kind: 'screenshot' },
        traceZip('traces/login.zip', UID)
      ],
      { attempt: 0 }
    )
    expect(linkedPath(manifest)).toBe('traces/login.zip')
  })

  it('links the keyless zip from the directory of the final attempt', () => {
    const manifest = manifestOf(
      [
        traceZip('run/session-retry2/trace.zip'),
        traceZip('run/session/trace.zip'),
        traceZip('run/session-retry10/trace.zip'),
        traceZip('run/session-retry1/trace.zip')
      ],
      { attempt: 1 }
    )
    expect(linkedPath(manifest)).toBe('run/session-retry1/trace.zip')
  })

  it('links nothing for a keyless final attempt whose zip is missing', () => {
    const manifest = manifestOf(
      [
        traceZip('run/session/trace.zip'),
        traceZip('run/session-retry1/trace.zip')
      ],
      { attempt: 2 }
    )
    expect(linkedPath(manifest)).toBeUndefined()
  })

  it('reads the retry from the directory, not the file name', () => {
    const manifest = manifestOf(
      [
        traceZip('run/session/trace-retry3.zip'),
        traceZip('run/session-retry1/trace.zip')
      ],
      { attempt: 1 }
    )
    expect(linkedPath(manifest)).toBe('run/session-retry1/trace.zip')
  })

  // A key names its attempt exactly, so it wins over a retry guessed from a directory name.
  it('ignores keyless zips once any candidate carries a key', () => {
    const manifest = manifestOf(
      [
        traceZip('run/session-retry5/trace.zip'),
        traceZip('traces/login.zip', UID)
      ],
      { attempt: 0 }
    )
    expect(linkedPath(manifest)).toBe('traces/login.zip')
  })
})
