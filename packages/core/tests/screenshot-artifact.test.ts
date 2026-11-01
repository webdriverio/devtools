import { describe, it, expect, afterEach } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  shouldCaptureScreenshot,
  writeScreenshotArtifact
} from '../src/screenshot-artifact.js'

describe('shouldCaptureScreenshot', () => {
  it('captures for `on` regardless of outcome', () => {
    expect(shouldCaptureScreenshot('on', false)).toBe(true)
    expect(shouldCaptureScreenshot('on', true)).toBe(true)
  })

  it('captures for `only-on-failure` only when failed', () => {
    expect(shouldCaptureScreenshot('only-on-failure', true)).toBe(true)
    expect(shouldCaptureScreenshot('only-on-failure', false)).toBe(false)
  })

  it('never captures for `off` or undefined', () => {
    expect(shouldCaptureScreenshot('off', true)).toBe(false)
    expect(shouldCaptureScreenshot(undefined, true)).toBe(false)
  })
})

describe('writeScreenshotArtifact', () => {
  const dirs: string[] = []
  afterEach(async () => {
    await Promise.all(
      dirs.splice(0).map((d) => rm(d, { recursive: true, force: true }))
    )
  })

  it('writes the decoded PNG and returns a test-scoped screenshot artifact', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'shot-'))
    dirs.push(dir)
    const base64 = Buffer.from('png-bytes').toString('base64')
    const artifact = await writeScreenshotArtifact({
      outputDir: dir,
      testUid: 'suite > a test/name',
      sessionId: 'abcd1234ef',
      base64
    })
    expect(artifact.kind).toBe('screenshot')
    expect(artifact.scope).toBe('test')
    expect(artifact.key).toBe('suite > a test/name')
    expect(artifact.retained).toBe(true)
    // Filename is slugged (no spaces/slashes) and session-scoped.
    expect(artifact.path).toMatch(/screenshot-suite-a-test-name-abcd1234\.png$/)
    expect(await readFile(artifact.path, 'utf8')).toBe('png-bytes')
  })
})
