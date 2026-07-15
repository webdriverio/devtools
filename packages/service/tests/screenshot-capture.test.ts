import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { TraceArtifact } from '@wdio/devtools-core'

const addAttachment = vi.fn()
vi.mock('@wdio/allure-reporter', () => ({
  addAttachment,
  default: { addAttachment }
}))

import { captureAndAttachScreenshot } from '../src/screenshot-capture.js'
import { resetAllureReporterCache } from '../src/allure.js'

const SHOT = Buffer.from('png-bytes').toString('base64')

describe('captureAndAttachScreenshot', () => {
  const dirs: string[] = []
  const collected: TraceArtifact[] = []
  beforeEach(() => {
    addAttachment.mockReset()
    resetAllureReporterCache()
    collected.length = 0
  })
  afterEach(async () => {
    await Promise.all(
      dirs.splice(0).map((d) => rm(d, { recursive: true, force: true }))
    )
  })

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
      onArtifact: (a) => collected.push(a),
      ...over
    })
    return { dir }
  }

  it('writes + attaches the reused snapshot on failure under only-on-failure', async () => {
    const { dir } = await run({})
    expect(collected).toHaveLength(1)
    expect(collected[0]!.kind).toBe('screenshot')
    expect(addAttachment).toHaveBeenCalledOnce()
    expect(await readdir(dir)).toHaveLength(1)
  })

  it('does nothing on a passing test under only-on-failure', async () => {
    await run({ failed: false })
    expect(collected).toHaveLength(0)
    expect(addAttachment).not.toHaveBeenCalled()
  })

  it('does nothing outside trace mode', async () => {
    await run({ mode: 'live', policy: 'on' })
    expect(collected).toHaveLength(0)
  })

  it('does nothing outside test granularity (uniform rule)', async () => {
    await run({ granularity: 'session', policy: 'on' })
    expect(collected).toHaveLength(0)
  })

  it('does nothing without a captured frame (no snapshot to reuse)', async () => {
    await run({ policy: 'on', screenshotBase64: undefined })
    expect(collected).toHaveLength(0)
  })

  it('does nothing without a sessionId or uid', async () => {
    await run({ sessionId: undefined })
    await run({ testUid: undefined })
    expect(collected).toHaveLength(0)
  })
})
