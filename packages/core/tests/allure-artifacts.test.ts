import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ActionSnapshot, ScreencastFrame } from '@wdio/devtools-shared'
import {
  attachTraceArtifact,
  captureAndAttachScreenshot,
  captureAndAttachVideo,
  lastRenderedScreenshot,
  type AllureAttachSink,
  type TestOutcome,
  type TraceArtifact
} from '../src/index.js'

function artifact(over: Partial<TraceArtifact> = {}): TraceArtifact {
  return {
    kind: 'trace',
    path: '',
    scope: 'test',
    testUids: ['u1'],
    retained: true,
    ...over
  }
}

const dirs: string[] = []
afterEach(async () => {
  await Promise.all(
    dirs.splice(0).map((d) => rm(d, { recursive: true, force: true }))
  )
})
async function tempFile(name: string, bytes = 'bytes'): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'allure-art-'))
  dirs.push(dir)
  const p = join(dir, name)
  await writeFile(p, bytes)
  return p
}

describe('attachTraceArtifact', () => {
  let sink: ReturnType<typeof vi.fn>
  const withSink = (a: TraceArtifact) =>
    attachTraceArtifact(a, sink as unknown as AllureAttachSink)
  beforeEach(() => {
    sink = vi.fn()
  })

  it('routes a trace zip to the sink as application/zip', async () => {
    const path = await tempFile('trace-abc.zip')
    await withSink(artifact({ path }))
    expect(sink).toHaveBeenCalledOnce()
    const [name, content, type] = sink.mock.calls[0]!
    expect(name).toBe('trace-abc.zip')
    expect(Buffer.isBuffer(content)).toBe(true)
    expect(type).toBe('application/zip')
  })

  it('maps video → video/webm and screenshot → image/png', async () => {
    await withSink(artifact({ kind: 'video', path: await tempFile('r.webm') }))
    await withSink(
      artifact({ kind: 'screenshot', path: await tempFile('s.png') })
    )
    expect(sink.mock.calls[0]![2]).toBe('video/webm')
    expect(sink.mock.calls[1]![2]).toBe('image/png')
  })

  it('no-ops for a non-retained artifact, an empty path, or an absent sink', async () => {
    await withSink(artifact({ retained: false, path: '/x.zip' }))
    await withSink(artifact({ path: '' }))
    expect(sink).not.toHaveBeenCalled()
    // undefined sink is produce-only, not an error
    await expect(
      attachTraceArtifact(artifact({ path: '/x.zip' }), undefined)
    ).resolves.toBeUndefined()
  })

  it('skips a directory path (ndjson-directory) without throwing', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'allure-dir-'))
    dirs.push(dir)
    await expect(withSink(artifact({ path: dir }))).resolves.toBeUndefined()
    expect(sink).not.toHaveBeenCalled()
  })

  it('never rejects when the path is missing', async () => {
    await expect(
      withSink(artifact({ path: '/no/such/trace.zip' }))
    ).resolves.toBeUndefined()
    expect(sink).not.toHaveBeenCalled()
  })
})

describe('lastRenderedScreenshot', () => {
  const snap = (
    command: string,
    timestamp: number,
    screenshot?: string
  ): ActionSnapshot => ({ command, timestamp, screenshot }) as ActionSnapshot

  it('returns the last non-final screenshot at/after the test start', () => {
    const snaps = [
      snap('click', 100, 'AA'),
      snap('setValue', 200, 'BB'),
      snap('__final__', 300, 'CC')
    ]
    expect(lastRenderedScreenshot(snaps, 100)).toBe('BB')
  })

  it('returns undefined when the only snapshots predate the test start', () => {
    expect(
      lastRenderedScreenshot([snap('click', 50, 'AA')], 100)
    ).toBeUndefined()
  })

  it('returns undefined when there are no snapshots', () => {
    expect(lastRenderedScreenshot([], 0)).toBeUndefined()
  })
})

describe('captureAndAttachScreenshot', () => {
  const collected: TraceArtifact[] = []
  let sink: ReturnType<typeof vi.fn>
  beforeEach(() => {
    collected.length = 0
    sink = vi.fn()
  })
  const SHOT = Buffer.from('png-bytes').toString('base64')

  async function run(
    over: Partial<Parameters<typeof captureAndAttachScreenshot>[0]>
  ) {
    const dir = await mkdtemp(join(tmpdir(), 'shot-cap-'))
    dirs.push(dir)
    await captureAndAttachScreenshot({
      mode: 'trace',
      granularity: 'test',
      policy: 'only-on-failure',
      failed: true,
      screenshotBase64: SHOT,
      sessionId: 'sess1234',
      outputDir: dir,
      testUid: 'u1',
      attach: sink as unknown as AllureAttachSink,
      onArtifact: (a) => collected.push(a),
      ...over
    })
    return dir
  }

  it('writes + attaches the reused snapshot on failure under only-on-failure', async () => {
    const dir = await run({})
    expect(collected).toHaveLength(1)
    expect(collected[0]!.kind).toBe('screenshot')
    expect(sink).toHaveBeenCalledOnce()
    expect(await readdir(dir)).toHaveLength(1)
  })

  it('produces without attaching when the sink is absent', async () => {
    await run({ attach: undefined })
    expect(collected).toHaveLength(1)
    expect(sink).not.toHaveBeenCalled()
  })

  it('no-ops on a passing test under only-on-failure', async () => {
    await run({ failed: false })
    expect(collected).toHaveLength(0)
    expect(sink).not.toHaveBeenCalled()
  })

  it('no-ops outside trace mode / test granularity / without frame / without ids', async () => {
    await run({ mode: 'live', policy: 'on' })
    await run({ granularity: 'session', policy: 'on' })
    await run({ policy: 'on', screenshotBase64: undefined })
    await run({ sessionId: undefined })
    await run({ testUid: undefined })
    expect(collected).toHaveLength(0)
  })
})

describe('captureAndAttachVideo gating', () => {
  // Every case no-ops BEFORE the ffmpeg encode (gate or non-retaining policy),
  // so no encoder/reporter mock is needed; the encode path is covered by
  // video-slice.test.ts.
  const collected: TraceArtifact[] = []
  beforeEach(() => {
    collected.length = 0
  })
  const frames: ScreencastFrame[] = [
    { data: 'AAAA', timestamp: 10 },
    { data: 'AAAA', timestamp: 20 }
  ]
  const failedOutcome: TestOutcome[] = [
    { uid: 'u1', attempt: 0, state: 'failed' }
  ]
  const passedOutcome: TestOutcome[] = [
    { uid: 'u1', attempt: 0, state: 'passed' }
  ]
  const base = {
    mode: 'trace' as const,
    granularity: 'test' as const,
    policy: 'retain-on-failure' as const,
    frames,
    startWallTime: 0,
    outcomes: failedOutcome,
    attempt: 0,
    outputDir: '/tmp/does-not-encode',
    testUid: 'u1',
    sessionId: 'sess1234',
    attach: undefined,
    onArtifact: (a: TraceArtifact) => collected.push(a)
  }

  it('no-ops for granularity/outcomes/policy/frames/ids gates and non-retaining outcome', async () => {
    await captureAndAttachVideo({ ...base, granularity: 'session' })
    await captureAndAttachVideo({ ...base, outcomes: [] })
    await captureAndAttachVideo({ ...base, policy: 'off' })
    await captureAndAttachVideo({ ...base, policy: undefined })
    await captureAndAttachVideo({ ...base, frames: undefined })
    await captureAndAttachVideo({ ...base, sessionId: undefined })
    await captureAndAttachVideo({ ...base, testUid: undefined })
    await captureAndAttachVideo({ ...base, outcomes: passedOutcome })
    expect(collected).toHaveLength(0)
  })
})
