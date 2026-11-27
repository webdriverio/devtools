import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import fsp from 'node:fs/promises'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { ARTIFACTS_MANIFEST_VERSION } from '@wdio/devtools-shared'
import { openTrace, openTraceWith, traceStateOf } from '../src/open-trace.js'
import type { HttpGet } from '../src/types.js'

const FIXTURE = fs.readFileSync(
  new URL(
    '../../trace/tests/fixtures/trace-formats/wdio-mocha-2026-11-10-ee505b9c.zip',
    import.meta.url
  )
)

const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'tq-open-')))
const root = path.join(base, 'root')
const run = path.join(root, 'run')
const outside = path.join(base, 'outside')

function put(file: string, bytes: Uint8Array | string = FIXTURE): string {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, bytes)
  return file
}

const TRACE_ID = '4bf92f3577b34da6a3ce929d0e0e4736'

function test(uid: string, fields: Record<string, unknown> = {}) {
  return {
    uid,
    title: `title of ${uid}`,
    specFile: 'specs/login.ts',
    state: 'passed',
    attempt: 0,
    ...fields
  }
}

function zip(zipPath: string, testUids: string[], scope: string, key?: string) {
  return { kind: 'trace', path: zipPath, scope, key, testUids, retained: true }
}

function manifest(sessionId: string, tests: unknown[], artifacts: unknown[]) {
  put(
    path.join(run, `devtools-artifacts-${sessionId}.json`),
    JSON.stringify({
      manifestVersion: ARTIFACTS_MANIFEST_VERSION,
      sessionId,
      tests,
      artifacts
    })
  )
}

put(path.join(run, 'login', 'trace.zip'))
put(path.join(run, 'retry', 'trace.zip'))
put(path.join(run, 'retry-retry1', 'trace.zip'))
put(path.join(run, 'session.zip'))
put(path.join(outside, 'secret.zip'))
fs.symlinkSync(outside, path.join(run, 'escape'))
manifest(
  's1',
  [
    test('u-login', { state: 'failed' }),
    test('u-retry', {
      attempt: 1,
      attempts: [
        {
          attempt: 0,
          state: 'failed',
          startTime: 1,
          traceId: TRACE_ID,
          spanId: '00f067aa0ba902b7'
        },
        {
          attempt: 1,
          state: 'passed',
          startTime: 2,
          final: true,
          traceId: TRACE_ID,
          spanId: '00f067aa0ba902b8'
        }
      ]
    }),
    test('u-a'),
    test('u-b'),
    test('u-dropped'),
    test('u-escape'),
    test('u-folder'),
    test('u-absolute')
  ],
  [
    zip('login/trace.zip', ['u-login'], 'test', 'u-login'),
    zip('retry/trace.zip', ['u-retry'], 'test', 'u-retry'),
    zip('retry-retry1/trace.zip', ['u-retry'], 'test', 'u-retry-retry1'),
    zip('session.zip', ['u-a', 'u-b'], 'session'),
    zip('escape/secret.zip', ['u-escape'], 'test', 'u-escape'),
    zip('not-a-zip', ['u-folder'], 'test', 'u-folder'),
    zip(
      path.join(run, 'login', 'trace.zip'),
      ['u-absolute'],
      'test',
      'u-absolute'
    )
  ]
)
manifest('s2', [test('u-login', { specFile: 'specs/other.ts' })], [])
put(path.join(root, 'py', 'only.zip'))
put(path.join(root, 'many', 'a', 'x.zip'))
put(path.join(root, 'many', 'b', 'y.zip'))
put(path.join(root, 'broken', 'devtools-artifacts-s9.json'), '{ not json')
fs.mkdirSync(path.join(run, 'not-a-zip'))
put(path.join(outside, 'devtools-artifacts-planted.json'), 'root:x:0:0')
fs.mkdirSync(path.join(root, 'planted'))
put(path.join(root, 'planted', 'only.zip'))
fs.symlinkSync(
  path.join(outside, 'devtools-artifacts-planted.json'),
  path.join(root, 'planted', 'devtools-artifacts-planted.json')
)

afterAll(() => fs.rmSync(base, { recursive: true, force: true }))

const OPTIONS = { allowedRoots: [root] }

afterEach(() => vi.restoreAllMocks())

describe('openTrace from a local path', () => {
  it('opens a zip inside an allowed root', async () => {
    const opened = await openTrace(
      path.join(run, 'login', 'trace.zip'),
      OPTIONS
    )
    expect(opened.source).toBe(path.join(run, 'login', 'trace.zip'))
    expect(opened.test).toBeUndefined()
    expect(
      traceStateOf(opened.handle).data.trace.commands.length
    ).toBeGreaterThan(0)
  })

  it('refuses a zip outside the allowed roots', async () => {
    await expect(
      openTrace(path.join(outside, 'secret.zip'), OPTIONS)
    ).rejects.toThrow('outside the allowed roots')
  })

  it('refuses every local path when no root is allowed', async () => {
    await expect(
      openTrace(path.join(run, 'login', 'trace.zip'))
    ).rejects.toThrow('no allowed root is configured')
  })

  it('refuses a zip larger than the limit', async () => {
    await expect(
      openTrace(path.join(run, 'login', 'trace.zip'), {
        ...OPTIONS,
        maxZipBytes: 100
      })
    ).rejects.toThrow('larger than the 100-byte limit')
  })

  it('refuses a trace that declares more to inflate than the limit', async () => {
    await expect(
      openTrace(path.join(run, 'login', 'trace.zip'), {
        ...OPTIONS,
        maxInflatedBytes: 100
      })
    ).rejects.toThrow('over the 100-byte limit')
  })
})

describe('openTrace from an output folder with manifests', () => {
  it('opens the test it is pointed at, by uid and spec file', async () => {
    const opened = await openTrace(run, OPTIONS, {
      uid: 'u-login',
      specFile: 'specs/login.ts'
    })
    expect(opened.source).toBe(path.join(run, 'login', 'trace.zip'))
    expect(opened.test).toEqual({
      uid: 'u-login',
      title: 'title of u-login',
      specFile: 'specs/login.ts',
      attempt: 0,
      state: 'failed',
      sharedZip: false
    })
    expect(traceStateOf(opened.handle).test).toEqual(opened.test)
  })

  it('reports the state of the attempt it opened, not the final one', async () => {
    const first = await openTrace(run, OPTIONS, { uid: 'u-retry', attempt: 0 })
    const final = await openTrace(run, OPTIONS, { uid: 'u-retry' })
    expect([first.test?.state, final.test?.state]).toEqual(['failed', 'passed'])
  })

  it('opens a zip the manifest names by an absolute path', async () => {
    const opened = await openTrace(run, OPTIONS, { uid: 'u-absolute' })
    expect(opened.source).toBe(path.join(run, 'login', 'trace.zip'))
  })

  it('opens the final attempt of a retried test unless told otherwise', async () => {
    const final = await openTrace(run, OPTIONS, { uid: 'u-retry' })
    const first = await openTrace(run, OPTIONS, { uid: 'u-retry', attempt: 0 })
    expect(final.source).toBe(path.join(run, 'retry-retry1', 'trace.zip'))
    expect(first.source).toBe(path.join(run, 'retry', 'trace.zip'))
  })

  it('says a session zip also holds other tests', async () => {
    const opened = await openTrace(run, OPTIONS, { uid: 'u-a' })
    expect(opened.source).toBe(path.join(run, 'session.zip'))
    expect(opened.test?.sharedZip).toBe(true)
  })

  it('asks for the spec file or session when a uid names several tests', async () => {
    await expect(openTrace(run, OPTIONS, { uid: 'u-login' })).rejects.toThrow(
      'uid u-login names 2 tests'
    )
    const bySession = await openTrace(run, OPTIONS, {
      uid: 'u-login',
      sessionId: 's1'
    })
    expect(bySession.source).toBe(path.join(run, 'login', 'trace.zip'))
  })

  it('names a uid the manifests do not hold', async () => {
    await expect(openTrace(run, OPTIONS, { uid: 'u-none' })).rejects.toThrow(
      `No test with uid u-none in the artifacts manifests in ${run}`
    )
  })

  it('lists the tests, failed first, when no test is named', async () => {
    const failure = openTrace(run, OPTIONS)
    await expect(failure).rejects.toThrow(
      `${run} records 9 tests; name one by its uid:`
    )
    await expect(failure).rejects.toThrow(
      /uid:\n {2}- u-login \(title of u-login, specs\/login\.ts, failed, session s1\)/
    )
  })

  it('says when the run kept no zip for the test', async () => {
    await expect(openTrace(run, OPTIONS, { uid: 'u-dropped' })).rejects.toThrow(
      'The run kept no trace zip for "title of u-dropped" attempt 0'
    )
  })

  it('refuses a zip the manifest names through a symlink out of the root', async () => {
    await expect(openTrace(run, OPTIONS, { uid: 'u-escape' })).rejects.toThrow(
      'outside the allowed roots'
    )
  })

  it('names a manifest that is not JSON', async () => {
    await expect(openTrace(path.join(root, 'broken'), OPTIONS)).rejects.toThrow(
      'devtools-artifacts-s9.json is not a JSON artifacts manifest'
    )
  })
})

describe('openTrace refusals inside a folder', () => {
  it('reads no manifest through a symlink, so a planted one opens the folder as manifest-less', async () => {
    const opened = await openTrace(path.join(root, 'planted'), OPTIONS)
    expect(opened.source).toBe(path.join(root, 'planted', 'only.zip'))
  })

  it('refuses a manifest entry that is not a regular file', async () => {
    await expect(openTrace(run, OPTIONS, { uid: 'u-folder' })).rejects.toThrow(
      'is not a regular file'
    )
  })

  it.each([5, -1, 0.5])(
    'refuses attempt %s, which the test does not have',
    async (attempt) => {
      await expect(
        openTrace(run, OPTIONS, { uid: 'u-retry', attempt })
      ).rejects.toThrow(
        `"title of u-retry" has no attempt ${attempt}; its attempts are 0 to 1`
      )
    }
  )

  it('refuses to read a zip swapped for a symlink out of the root after it was opened', async () => {
    const zipPath = put(path.join(root, 'swap', 'trace.zip'))
    const { handle } = await openTrace(zipPath, OPTIONS)
    const { archive, data } = traceStateOf(handle)
    fs.rmSync(zipPath)
    fs.symlinkSync(path.join(outside, 'secret.zip'), zipPath)
    await expect(archive.read(data.frames[0]!.entry)).rejects.toThrow(
      'changed since the trace was opened'
    )
  })

  it('refuses to read a zip rewritten in place after it was opened', async () => {
    const zipPath = put(path.join(root, 'rewrite', 'trace.zip'))
    const { handle } = await openTrace(zipPath, OPTIONS)
    const { archive, data } = traceStateOf(handle)
    const later = new Date(fs.statSync(zipPath).mtimeMs + 60_000)
    fs.utimesSync(zipPath, later, later)
    await expect(archive.read(data.frames[0]!.entry)).rejects.toThrow(
      'changed since the trace was opened'
    )
  })
})

describe('openTrace while the path is being swapped', () => {
  it('refuses a zip swapped for another file while it was checked', async () => {
    const zipPath = put(path.join(root, 'race', 'trace.zip'))
    const other = put(path.join(root, 'race', 'other.zip'))
    const realpath = fsp.realpath
    let calls = 0
    // The second resolution of the zip is the one inside the identity check; the first is openTrace's own path check.
    vi.spyOn(fsp, 'realpath').mockImplementation(async (target, ...rest) => {
      if (target === zipPath && ++calls === 2) {
        fs.renameSync(other, zipPath)
      }
      return realpath(target, ...rest)
    })
    await expect(openTrace(zipPath, OPTIONS)).rejects.toThrow(
      'it changed while it was checked'
    )
  })
})

describe('openTrace from a folder without a manifest', () => {
  it('opens its only zip', async () => {
    const opened = await openTrace(path.join(root, 'py'), OPTIONS)
    expect(opened.source).toBe(path.join(root, 'py', 'only.zip'))
  })

  it('cannot find a test by uid without a manifest', async () => {
    await expect(
      openTrace(path.join(root, 'py'), OPTIONS, { uid: 'u-login' })
    ).rejects.toThrow(
      'has no artifacts manifest, so a test cannot be found by its uid'
    )
  })

  it('lists its zips when it holds several', async () => {
    await expect(openTrace(path.join(root, 'many'), OPTIONS)).rejects.toThrow(
      /holds 2 trace zips and no artifacts manifest; open one of its zips:\n {2}- a\/x\.zip\n {2}- b\/y\.zip/
    )
  })
})

describe('openTrace from a URL', () => {
  const get: HttpGet = async () => ({
    status: 200,
    body: (async function* () {
      yield new Uint8Array(FIXTURE)
    })(),
    discard: () => {}
  })

  it('downloads from an allowed host and names it without its query string', async () => {
    const opened = await openTraceWith(
      'https://bucket.example.com/run-1/trace.zip?sig=secret',
      { allowedHosts: ['bucket.example.com'] },
      undefined,
      get
    )
    expect(opened.source).toBe('https://bucket.example.com/run-1/trace.zip')
    expect(
      traceStateOf(opened.handle).data.trace.commands.length
    ).toBeGreaterThan(0)
  })

  it('refuses a scheme other than https', async () => {
    await expect(
      openTraceWith(
        'file:///etc/passwd',
        { allowedHosts: ['bucket.example.com'] },
        undefined,
        get
      )
    ).rejects.toThrow('only https URLs are fetched')
  })
})
