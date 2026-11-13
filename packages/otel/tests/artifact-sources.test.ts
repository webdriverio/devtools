import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
  realpathSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { describe, expect, it, vi } from 'vitest'
import {
  ARTIFACTS_MANIFEST_VERSION,
  type TestAttemptRecord
} from '@wdio/devtools-shared'
import path from 'node:path'
import {
  relativeWithin,
  traceArtifactsByUid,
  zipReader
} from '../src/artifact-sources.js'
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
    manifestVersion: ARTIFACTS_MANIFEST_VERSION,
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

describe('relativeWithin', () => {
  const dir = path.resolve('run-dir')

  it('returns the path of a file inside the directory', () => {
    expect(relativeWithin(dir, path.join(dir, 'traces', 'a.zip'))).toBe(
      path.join('traces', 'a.zip')
    )
  })

  it('refuses a file that escapes the directory with ..', () => {
    expect(
      relativeWithin(dir, path.resolve(dir, '../elsewhere/a.zip'))
    ).toBeUndefined()
  })

  it('refuses a file elsewhere on disk', () => {
    expect(relativeWithin(dir, path.resolve('other', 'a.zip'))).toBeUndefined()
  })

  it('refuses a sibling whose name only starts with the directory name', () => {
    expect(relativeWithin(dir, path.join(`${dir}c`, 'a.zip'))).toBeUndefined()
  })

  it('allows a file whose name starts with two dots', () => {
    expect(relativeWithin(dir, path.join(dir, '..foo.zip'))).toBe('..foo.zip')
  })

  it('refuses the directory itself', () => {
    expect(relativeWithin(dir, dir)).toBeUndefined()
  })
})

describe('zipReader containment', () => {
  const dir = path.resolve('run-dir')
  const realpath = (target: string): string => target

  it('reads a zip inside the directory', () => {
    const loadZip = vi.fn(() => {
      throw new Error('stop after the containment check')
    })
    const warn = vi.fn()
    zipReader({ loadZip, realpath, warn }).read(path.join(dir, 'a.zip'), dir)
    expect(loadZip).toHaveBeenCalledWith(path.join(dir, 'a.zip'))
    expect(warn.mock.calls[0][0]).toContain('could not be read')
  })

  it('loads the zip from the real path that passed the containment check', () => {
    const real = path.join(dir, 'targets', 'a.zip')
    const loadZip = vi.fn(() => {
      throw new Error('stop after the containment check')
    })
    const warn = vi.fn()
    const reader = zipReader({
      loadZip,
      realpath: (target) =>
        target === path.join(dir, 'a.zip') ? real : target,
      warn
    })
    reader.read(path.join(dir, 'a.zip'), dir)
    expect(loadZip).toHaveBeenCalledWith(real)
  })

  it('refuses a zip that escapes the directory with ..', () => {
    const loadZip = vi.fn(() => new Uint8Array())
    const warn = vi.fn()
    const zip = path.resolve(dir, '../elsewhere/a.zip')
    const reader = zipReader({ loadZip, realpath, warn })
    expect(reader.read(zip, dir)).toBeUndefined()
    expect(loadZip).not.toHaveBeenCalled()
    expect(reader.unreadable()).toEqual([zip])
  })

  it('refuses a zip through a symlink whose real path is outside the directory', () => {
    const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'otel-zip-')))
    try {
      const manifestDir = path.join(root, 'results')
      const outside = path.join(root, 'outside')
      mkdirSync(manifestDir)
      mkdirSync(outside)
      writeFileSync(path.join(outside, 'trace.zip'), 'zip')
      symlinkSync(
        path.join(outside, 'trace.zip'),
        path.join(manifestDir, 'link.zip')
      )
      const loadZip = vi.fn(() => new Uint8Array())
      const warn = vi.fn()
      const reader = zipReader({ loadZip, realpath: realpathSync, warn })
      const link = path.join(manifestDir, 'link.zip')
      expect(reader.read(link, manifestDir)).toBeUndefined()
      expect(loadZip).not.toHaveBeenCalled()
      expect(warn.mock.calls[0][0]).toContain('outside the manifest directory')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('refuses a zip through an injected realpath that resolves outside the directory', () => {
    const loadZip = vi.fn(() => new Uint8Array())
    const warn = vi.fn()
    const reader = zipReader({
      loadZip,
      realpath: (target) =>
        target.endsWith('a.zip') ? path.resolve('elsewhere', 'a.zip') : target,
      warn
    })
    expect(reader.read(path.join(dir, 'a.zip'), dir)).toBeUndefined()
    expect(loadZip).not.toHaveBeenCalled()
  })

  it('reports a missing zip as unreadable rather than outside', () => {
    const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'otel-zip-')))
    try {
      const warn = vi.fn()
      const reader = zipReader({
        loadZip: () => new Uint8Array(),
        realpath: realpathSync,
        warn
      })
      const missing = path.join(root, 'missing.zip')
      expect(reader.read(missing, root)).toBeUndefined()
      expect(warn.mock.calls[0][0]).toContain('could not be read')
      expect(reader.unreadable()).toEqual([missing])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
